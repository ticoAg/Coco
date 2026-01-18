use serde::Serialize;
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::AtomicI64;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;
use tokio::process::Child;
use tokio::process::ChildStderr;
use tokio::process::ChildStdin;
use tokio::process::ChildStdout;
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use tokio::sync::OnceCell;
use tokio::time::timeout;

use crate::codex_patch_diff;

const EVENT_NAME: &str = "codex_app_server";
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const CODEX_BIN_ENV: &str = "AGENTMESH_CODEX_BIN";
const SHELL_ENV_TIMEOUT_SECS: u64 = 2;
const ENV_BEGIN_SENTINEL: &[u8] = b"__AGENTMESH_ENV_BEGIN__\0";
const ENV_END_SENTINEL: &[u8] = b"__AGENTMESH_ENV_END__\0";

static SHELL_ENV_CACHE: OnceCell<ShellEnvSnapshot> = OnceCell::const_new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexJsonRpcEvent {
    pub app_server_id: String,
    pub kind: String,
    pub message: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    pub id: i64,
    pub method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcNotification<'a> {
    pub method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    pub id: i64,
    pub result: Value,
}

#[derive(Clone)]
pub struct CodexAppServer {
    inner: Arc<CodexAppServerInner>,
}

struct CodexAppServerInner {
    app: tauri::AppHandle,
    app_server_id: String,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>,
    next_request_id: AtomicI64,
    cwd: PathBuf,
}

impl CodexAppServer {
    pub async fn spawn(
        app: tauri::AppHandle,
        cwd: &Path,
        profile: Option<String>,
        codex_home: Option<&Path>,
        app_server_id: String,
    ) -> Result<Self, String> {
        let (codex_bin, env, env_source) = resolve_codex_bin_and_env().await?;

        let mut cmd = Command::new(codex_bin);
        if let Some(profile) = profile.as_deref().filter(|p| !p.trim().is_empty()) {
            cmd.arg("-c").arg(format!("profile={profile}"));
        }
        cmd.arg("app-server")
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear()
            .envs(env)
            .env("AGENTMESH_CODEX_ENV_SOURCE", env_source)
            .current_dir(cwd);

        if let Some(home) = codex_home {
            std::fs::create_dir_all(home).map_err(|e| e.to_string())?;
            cmd.env("CODEX_HOME", home);
        }

        let mut child = cmd.spawn().map_err(|e| e.to_string())?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "codex app-server stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "codex app-server stdout unavailable".to_string())?;
        let stderr = child.stderr.take();

        let inner = Arc::new(CodexAppServerInner {
            app: app.clone(),
            app_server_id,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_request_id: AtomicI64::new(-1),
            cwd: cwd.to_path_buf(),
        });

        tokio::spawn(run_stdout_loop(Arc::clone(&inner), stdout));
        if let Some(stderr) = stderr {
            tokio::spawn(run_stderr_loop(Arc::clone(&inner), stderr));
        }

        let server = Self { inner };
        server.initialize().await?;
        Ok(server)
    }

    async fn initialize(&self) -> Result<(), String> {
        let params = json!({
            "clientInfo": {
                "name": "codex_cli_rs",
                "title": "AgentMesh GUI",
                "version": env!("CARGO_PKG_VERSION"),
            }
        });

        let _ = self.request("initialize", Some(params)).await?;
        self.notify("initialized", None).await?;
        Ok(())
    }

    pub async fn request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.inner.next_request_id.fetch_sub(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.inner.pending.lock().await;
            pending.insert(id, tx);
        }

        let request = JsonRpcRequest { id, method, params };
        self.send_json(&request).await?;

        let res = timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS), rx)
            .await
            .map_err(|_| format!("{method} timed out after {DEFAULT_TIMEOUT_SECS}s"))?
            .map_err(|_| format!("{method} response channel closed"))?;

        match res {
            Ok(value) => Ok(value),
            Err(err) => Err(err),
        }
    }

    pub async fn notify(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let notification = JsonRpcNotification { method, params };
        self.send_json(&notification).await
    }

    pub async fn respond(&self, request_id: i64, result: Value) -> Result<(), String> {
        let response = JsonRpcResponse {
            id: request_id,
            result,
        };
        self.send_json(&response).await
    }

    pub async fn shutdown(&self) {
        let mut child = self.inner.child.lock().await;
        let _ = child.start_kill();
        let _ = child.wait().await;
    }

    async fn send_json<T: Serialize>(&self, msg: &T) -> Result<(), String> {
        let line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        let mut stdin = self.inner.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDiagnostics {
    pub path: String,
    pub resolved_codex_bin: Option<String>,
    pub env_override: Option<String>,
    pub path_source: String,
    pub shell: Option<String>,
    pub env_source: String,
    pub env_count: usize,
}

pub async fn codex_diagnostics() -> CodexDiagnostics {
    let env_override = std::env::var_os(CODEX_BIN_ENV)
        .map(|v| v.to_string_lossy().to_string())
        .filter(|v| !v.trim().is_empty());

    let (path_env, path_source, shell, env_source, env_count) = preferred_shell_env().await;
    let path_str = path_env.to_string_lossy().to_string();
    let resolved_codex_bin = find_executable_in_paths(
        "codex",
        &std::env::split_paths(&path_env).collect::<Vec<_>>(),
    )
    .map(|p| p.to_string_lossy().to_string());

    CodexDiagnostics {
        path: path_str,
        resolved_codex_bin,
        env_override,
        path_source,
        shell,
        env_source,
        env_count,
    }
}

async fn resolve_codex_bin_and_env(
) -> Result<(PathBuf, HashMap<OsString, OsString>, String), String> {
    let (path_env, _path_source, _shell, env_source, _env_count) = preferred_shell_env().await;

    if let Some(bin) = std::env::var_os(CODEX_BIN_ENV) {
        let path = PathBuf::from(bin);
        if path.is_file() {
            let env = merged_env_with_path(&path_env);
            return Ok((path, env, env_source));
        }
        return Err(format!(
            "{CODEX_BIN_ENV} points to a missing file: {}",
            path.display()
        ));
    }

    let search_paths = std::env::split_paths(&path_env).collect::<Vec<_>>();
    if let Some(found) = find_executable_in_paths("codex", &search_paths) {
        let env = merged_env_with_path(&path_env);
        return Ok((found, env, env_source));
    }

    Err(format!(
        "codex not found on PATH. Hint (macOS): GUI apps started from Finder may not inherit your shell PATH. Set {CODEX_BIN_ENV}=/opt/homebrew/bin/codex or launch from Terminal."
    ))
}

async fn preferred_shell_env() -> (OsString, String, Option<String>, String, usize) {
    if let Ok(snapshot) = shell_env_snapshot().await {
        return (
            snapshot.path.clone(),
            "shell".to_string(),
            Some(snapshot.shell.clone()),
            "shell".to_string(),
            snapshot.env.len(),
        );
    }

    let path = ensure_codex_path_env();
    (
        path,
        "fallback".to_string(),
        None,
        "fallback".to_string(),
        std::env::vars_os().count(),
    )
}

#[derive(Debug, Clone)]
struct ShellEnvSnapshot {
    shell: String,
    path: OsString,
    env: HashMap<OsString, OsString>,
}

async fn shell_env_snapshot() -> Result<ShellEnvSnapshot, String> {
    SHELL_ENV_CACHE
        .get_or_try_init(|| async { compute_shell_env_snapshot().await })
        .await
        .cloned()
}

async fn compute_shell_env_snapshot() -> Result<ShellEnvSnapshot, String> {
    let shell = std::env::var_os("SHELL")
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/sh".to_string()
            }
        });

    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("sh");

    let flag = match shell_name {
        "zsh" | "bash" => "-lic",
        _ => return Err(format!("unsupported shell for env sync: {shell}")),
    };

    // Use NUL-separated output so values are unambiguous. Surround with sentinels so we can
    // ignore any stray stdout from shell init plugins.
    let cmd =
        "printf '__AGENTMESH_ENV_BEGIN__\\0'; /usr/bin/env -0; printf '__AGENTMESH_ENV_END__\\0'"
            .to_string();

    let mut proc = Command::new(&shell);
    proc.arg(flag)
        .arg(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = proc.spawn().map_err(|e| e.to_string())?;
    let output = timeout(
        std::time::Duration::from_secs(SHELL_ENV_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| format!("shell env sync timed out after {SHELL_ENV_TIMEOUT_SECS}s"))?
    .map_err(|e| e.to_string())?;

    let stdout = output.stdout;
    let start = find_bytes(&stdout, ENV_BEGIN_SENTINEL)
        .map(|pos| pos + ENV_BEGIN_SENTINEL.len())
        .ok_or_else(|| "shell env sync did not include begin sentinel".to_string())?;
    let end = find_bytes(&stdout[start..], ENV_END_SENTINEL)
        .map(|pos| start + pos)
        .ok_or_else(|| "shell env sync did not include end sentinel".to_string())?;

    let mut env = HashMap::new();
    for record in stdout[start..end].split(|b| *b == 0) {
        if record.is_empty() {
            continue;
        }
        let Some(eq_pos) = record.iter().position(|b| *b == b'=') else {
            continue;
        };
        if eq_pos == 0 {
            continue;
        }
        let key = OsString::from(String::from_utf8_lossy(&record[..eq_pos]).to_string());
        let value = OsString::from(String::from_utf8_lossy(&record[eq_pos + 1..]).to_string());
        env.insert(key, value);
    }

    let path = env
        .get(&OsString::from("PATH"))
        .cloned()
        .unwrap_or_else(ensure_codex_path_env);

    Ok(ShellEnvSnapshot { shell, path, env })
}

fn merged_env_with_path(path: &OsString) -> HashMap<OsString, OsString> {
    let mut out = std::env::vars_os().collect::<HashMap<_, _>>();
    out.insert(OsString::from("PATH"), path.clone());

    if let Some(snapshot) = SHELL_ENV_CACHE.get() {
        for (k, v) in snapshot.env.iter() {
            out.insert(k.clone(), v.clone());
        }
    }

    out
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn ensure_codex_path_env() -> OsString {
    let mut paths = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();

    for extra in default_search_dirs() {
        if paths.iter().any(|p| p == &extra) {
            continue;
        }
        paths.push(extra);
    }

    std::env::join_paths(paths).unwrap_or_else(|_| OsString::from("/usr/bin:/bin:/usr/sbin:/sbin"))
}

fn default_search_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if cfg!(target_os = "macos") {
        out.push(PathBuf::from("/opt/homebrew/bin"));
        out.push(PathBuf::from("/usr/local/bin"));
    }

    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        out.push(home.join(".local").join("bin"));
        out.push(home.join(".cargo").join("bin"));
    }

    out
}

fn find_executable_in_paths(name: &str, paths: &[PathBuf]) -> Option<PathBuf> {
    for base in paths {
        let candidate = base.join(name);
        if is_executable_file(&candidate) {
            return Some(candidate);
        }

        #[cfg(windows)]
        {
            for suffix in [".exe", ".cmd", ".bat"] {
                let candidate = base.join(format!("{name}{suffix}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn is_executable_file(path: &Path) -> bool {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if !meta.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        (meta.permissions().mode() & 0o111) != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

async fn run_stdout_loop(inner: Arc<CodexAppServerInner>, stdout: ChildStdout) {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();

    loop {
        buf.clear();
        let bytes_read = match reader.read_until(b'\n', &mut buf).await {
            Ok(n) => n,
            Err(_) => break,
        };
        if bytes_read == 0 {
            break;
        }

        // Safely convert bytes to UTF-8, replacing invalid sequences with U+FFFD
        let line = String::from_utf8_lossy(&buf);
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let mut parsed: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(err) => {
                let _ = inner.app.emit(
                    EVENT_NAME,
                    CodexJsonRpcEvent {
                        app_server_id: inner.app_server_id.clone(),
                        kind: "error".to_string(),
                        message: json!({
                            "type": "parse_error",
                            "error": err.to_string(),
                            "line": line,
                        }),
                    },
                );
                continue;
            }
        };

        // Response to a client request (id + result).
        if parsed.get("result").is_some() {
            if let Some(id) = parsed.get("id").and_then(as_i64) {
                let result = parsed.get("result").cloned().unwrap_or(Value::Null);
                let tx = {
                    let mut pending = inner.pending.lock().await;
                    pending.remove(&id)
                };
                if let Some(tx) = tx {
                    let _ = tx.send(Ok(result));
                }
                continue;
            }
        }

        // Error response to a client request (id + error).
        if parsed.get("error").is_some() {
            if let Some(id) = parsed.get("id").and_then(as_i64) {
                let message = parsed
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error")
                    .to_string();

                let tx = {
                    let mut pending = inner.pending.lock().await;
                    pending.remove(&id)
                };
                if let Some(tx) = tx {
                    let _ = tx.send(Err(message));
                }
                continue;
            }
        }

        // Server-initiated request (method + id + params), e.g. approvals.
        if parsed.get("method").is_some() && parsed.get("id").is_some() {
            let _ = inner.app.emit(
                EVENT_NAME,
                CodexJsonRpcEvent {
                    app_server_id: inner.app_server_id.clone(),
                    kind: "request".to_string(),
                    message: parsed,
                },
            );
            continue;
        }

        // Notification (method + params, no id).
        if parsed.get("method").is_some() {
            if let Some(method) = parsed.get("method").and_then(|v| v.as_str()) {
                if method == "item/started" || method == "item/completed" {
                    let cwd = inner.cwd.clone();
                    enrich_file_change_notification(&mut parsed, &cwd).await;
                }
            }
            let _ = inner.app.emit(
                EVENT_NAME,
                CodexJsonRpcEvent {
                    app_server_id: inner.app_server_id.clone(),
                    kind: "notification".to_string(),
                    message: parsed,
                },
            );
            continue;
        }

        // Unknown message.
        let _ = inner.app.emit(
            EVENT_NAME,
            CodexJsonRpcEvent {
                app_server_id: inner.app_server_id.clone(),
                kind: "unknown".to_string(),
                message: parsed,
            },
        );
    }

    // If stdout closes, surface and fail any pending requests.
    let mut pending = inner.pending.lock().await;
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err("codex app-server closed stdout".to_string()));
    }
}

async fn run_stderr_loop(inner: Arc<CodexAppServerInner>, stderr: ChildStderr) {
    let mut reader = BufReader::new(stderr);
    let mut buf = Vec::new();

    loop {
        buf.clear();
        let bytes_read = match reader.read_until(b'\n', &mut buf).await {
            Ok(n) => n,
            Err(_) => break,
        };
        if bytes_read == 0 {
            break;
        }

        // Safely convert bytes to UTF-8, replacing invalid sequences with U+FFFD
        let line = String::from_utf8_lossy(&buf);
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let _ = inner.app.emit(
            EVENT_NAME,
            CodexJsonRpcEvent {
                app_server_id: inner.app_server_id.clone(),
                kind: "stderr".to_string(),
                message: json!({ "line": line }),
            },
        );
    }
}

fn as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse::<i64>().ok(),
        _ => None,
    }
}

async fn enrich_file_change_notification(message: &mut Value, cwd: &Path) {
    let method = message.get("method").and_then(|v| v.as_str()).unwrap_or("");
    if method != "item/started" && method != "item/completed" {
        return;
    }
    let Some(params) = message.get_mut("params") else {
        return;
    };
    let Some(item) = params.get_mut("item") else {
        return;
    };
    if item.get("type").and_then(|v| v.as_str()) != Some("fileChange") {
        return;
    }

    let Some(existing_changes) = item.get("changes").and_then(|v| v.as_array()).cloned() else {
        return;
    };

    let mut updated: Vec<Value> = Vec::with_capacity(existing_changes.len());
    for mut change in existing_changes {
        let path = change
            .get("path")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());
        let diff = change
            .get("diff")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());
        let kind = change.get("kind").cloned().unwrap_or(Value::Null);
        if let (Some(path), Some(diff)) = (path, diff) {
            let (next_diff, line_numbers_available) =
                codex_patch_diff::enrich_file_change_diff(&path, &kind, &diff, Some(cwd)).await;
            if let Some(obj) = change.as_object_mut() {
                obj.insert("diff".to_string(), Value::String(next_diff));
                obj.insert(
                    "lineNumbersAvailable".to_string(),
                    Value::Bool(line_numbers_available),
                );
            }
        }
        updated.push(change);
    }

    if let Some(obj) = item.as_object_mut() {
        obj.insert("changes".to_string(), Value::Array(updated));
    }
}
