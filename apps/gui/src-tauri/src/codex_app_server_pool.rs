use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::Path;
use std::path::PathBuf;

use crate::codex_app_server::CodexAppServer;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CodexAppServerKey {
    codex_home: PathBuf,
}

#[derive(Clone)]
struct CodexAppServerEntry {
    server: CodexAppServer,
    profile: Option<String>,
}

pub struct CodexAppServerPool {
    servers_by_id: HashMap<String, CodexAppServerEntry>,
    id_by_key: HashMap<CodexAppServerKey, String>,
    max_servers: usize,
}

impl CodexAppServerPool {
    pub fn new(max_servers: usize) -> Self {
        Self {
            servers_by_id: HashMap::new(),
            id_by_key: HashMap::new(),
            max_servers,
        }
    }

    pub fn get(&self, app_server_id: &str) -> Option<CodexAppServer> {
        self.servers_by_id
            .get(app_server_id)
            .map(|entry| entry.server.clone())
    }

    pub async fn ensure(
        &mut self,
        app: tauri::AppHandle,
        cwd: &Path,
        codex_home: &Path,
        profile: Option<String>,
    ) -> Result<String, String> {
        let codex_home = canonicalize_or_abs(codex_home)?;
        std::fs::create_dir_all(&codex_home).map_err(|e| e.to_string())?;

        let key = CodexAppServerKey {
            codex_home: codex_home.clone(),
        };
        let app_server_id = self
            .id_by_key
            .get(&key)
            .cloned()
            .unwrap_or_else(|| app_server_id_for_key(&key));

        if let Some(existing) = self.servers_by_id.get(&app_server_id) {
            // If the caller requests a different profile than the one the process was spawned with,
            // restart this CODEX_HOME-scoped app-server instance.
            let profile_changed = normalize_profile(existing.profile.as_deref())
                != normalize_profile(profile.as_deref());
            if !profile_changed {
                return Ok(app_server_id);
            }

            let server = existing.server.clone();
            server.shutdown().await;
            self.servers_by_id.remove(&app_server_id);
        }

        if self.servers_by_id.len() >= self.max_servers {
            return Err(format!(
                "codex app-server pool full (max={}); shutdown an instance before starting a new one",
                self.max_servers
            ));
        }

        let server = CodexAppServer::spawn(
            app,
            cwd,
            profile.clone(),
            Some(&codex_home),
            app_server_id.clone(),
        )
        .await?;

        self.id_by_key.insert(key, app_server_id.clone());
        self.servers_by_id.insert(
            app_server_id.clone(),
            CodexAppServerEntry {
                server,
                profile,
            },
        );

        Ok(app_server_id)
    }

    pub async fn shutdown(&mut self, app_server_id: &str) {
        let Some(entry) = self.servers_by_id.remove(app_server_id) else {
            return;
        };
        // Remove key -> id mapping if present.
        self.id_by_key.retain(|_, id| id != app_server_id);
        entry.server.shutdown().await;
    }

    pub async fn shutdown_all(&mut self) {
        let entries = std::mem::take(&mut self.servers_by_id);
        self.id_by_key.clear();
        for (_, entry) in entries {
            entry.server.shutdown().await;
        }
    }

    pub async fn shutdown_by_codex_home(&mut self, codex_home: &Path) {
        let codex_home = match canonicalize_or_abs(codex_home) {
            Ok(p) => p,
            Err(_) => return,
        };
        let key = CodexAppServerKey { codex_home };
        let Some(id) = self.id_by_key.get(&key).cloned() else {
            return;
        };
        self.shutdown(&id).await;
    }
}

fn normalize_profile(profile: Option<&str>) -> Option<String> {
    profile
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string())
}

fn app_server_id_for_key(key: &CodexAppServerKey) -> String {
    // Deterministic id so front-end can store it and re-ensure without changing identifiers.
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    let hash = hasher.finish();
    format!("asrv_{hash:016x}")
}

fn canonicalize_or_abs(path: &Path) -> Result<PathBuf, String> {
    // canonicalize() fails if the directory doesn't exist yet. For CODEX_HOME we can resolve
    // best-effort and then create it.
    if path.exists() {
        return std::fs::canonicalize(path).map_err(|e| e.to_string());
    }
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        Ok(cwd.join(path))
    }
}
