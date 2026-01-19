use tauri::Manager;

mod codex_app_server;
mod codex_app_server_pool;
mod codex_patch_diff;
mod codex_rollout_restore;

use codex_app_server::CodexAppServer;
use codex_app_server::CodexDiagnostics;
use codex_app_server_pool::CodexAppServerPool;
use std::sync::atomic::AtomicU32;
use std::sync::atomic::Ordering;
use tokio::sync::Mutex as TokioMutex;

const CODEX_APP_SERVER_POOL_MAX: usize = 8;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SubagentSessionSummary {
    agent_instance: String,
    status: String,
    last_updated_at_ms: Option<u64>,
    adapter: Option<String>,
    has_final: bool,
    has_events: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SubagentFinalOutput {
    exists: bool,
    json: Option<serde_json::Value>,
    parse_error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedArtifactSummary {
    path: String,
    filename: String,
    updated_at_ms: Option<u64>,
    size_bytes: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedArtifactContent {
    path: String,
    content: String,
    updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskTextFileContent {
    path: String,
    exists: bool,
    content: Option<String>,
    updated_at_ms: Option<u64>,
    size_bytes: Option<u64>,
    truncated: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskDirectoryEntry {
    name: String,
    path: String,
    is_directory: bool,
    size_bytes: Option<u64>,
    updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadSummary {
    id: String,
    preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    model_provider: String,
    created_at: i64,
    updated_at_ms: Option<u64>,
    interaction_count: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadListResponse {
    data: Vec<CodexThreadSummary>,
    next_cursor: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadLoadedListResponse {
    data: Vec<String>,
    next_cursor: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadTitleSidecar {
    title: String,
    source: String, // "manual"
    #[serde(default)]
    updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadArchiveGuard {
    archived_at_ms: u64,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            cluster_status,
            list_tasks,
            get_task,
            get_task_events,
            create_task,
            list_subagent_sessions,
            get_subagent_final_output,
            tail_subagent_events,
            tail_subagent_stderr,
            task_read_text_file,
            task_list_directory,
            workspace_list_directory,
            workspace_write_file,
            workspace_rename_file,
            list_shared_artifacts,
            read_shared_artifact,
            workspace_root_get,
            workspace_root_set,
            workspace_recent_list,
            window_new,
            codex_app_server_ensure,
            codex_app_server_shutdown,
            codex_thread_list,
            codex_thread_loaded_list,
            codex_thread_title_set,
            codex_thread_archive,
            codex_thread_start,
            codex_thread_resume,
            codex_thread_fork,
            codex_thread_rollback,
            codex_turn_start,
            codex_turn_interrupt,
            codex_respond_approval,
            codex_model_list,
            codex_config_read_effective,
            codex_config_write_chat_defaults,
            codex_set_profile,
            codex_read_config,
            codex_write_config,
            codex_diagnostics,
            codex_skill_list,
            codex_prompt_list,
            // Context management commands
            search_workspace_files,
            read_file_content,
            get_auto_context,
            git_worktree_list,
            git_branch_list,
            git_worktree_create,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let app_handle = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    let mut pool = state.codex_pool.lock().await;
                    pool.shutdown_all().await;
                });
            }
        })
        .setup(|app| {
            let workspace_root = resolve_workspace_root(app.handle())?;
            let _ = update_recent_workspaces(app.handle(), &workspace_root);
            app.manage(AppState {
                orchestrator: std::sync::Mutex::new(agentmesh_orchestrator::Orchestrator::new(
                    workspace_root,
                )),
                codex_pool: TokioMutex::new(CodexAppServerPool::new(CODEX_APP_SERVER_POOL_MAX)),
                codex_profile: TokioMutex::new(None),
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

struct AppState {
    orchestrator: std::sync::Mutex<agentmesh_orchestrator::Orchestrator>,
    codex_pool: TokioMutex<CodexAppServerPool>,
    codex_profile: TokioMutex<Option<String>>,
}

static NEXT_WINDOW_ID: AtomicU32 = AtomicU32::new(2);

fn resolve_workspace_root<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<std::path::PathBuf> {
    if let Ok(root) = std::env::var("AGENTMESH_WORKSPACE_ROOT") {
        let path = std::path::PathBuf::from(root);
        std::fs::create_dir_all(&path)?;
        return Ok(path);
    }

    if let Some(path) = read_persisted_workspace_root(app) {
        if std::fs::create_dir_all(&path).is_ok() {
            return Ok(path);
        }
    }

    // Dev convenience: if running from the repo, keep state in the repo workspace root.
    if cfg!(debug_assertions) {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir.join("../../..");
        if repo_root.join(".agentmesh").exists() {
            return Ok(repo_root);
        }
    }

    let app_data = app.path().app_data_dir()?;
    let path = app_data.join("workspace");
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

fn persisted_workspace_root_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<std::path::PathBuf> {
    Ok(app.path().app_data_dir()?.join("workspace_root.txt"))
}

fn read_persisted_workspace_root<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<std::path::PathBuf> {
    let path = persisted_workspace_root_path(app).ok()?;
    let content = std::fs::read_to_string(path).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(std::path::PathBuf::from(trimmed))
}

fn persist_workspace_root<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    workspace_root: &std::path::Path,
) -> Result<(), String> {
    let path = persisted_workspace_root_path(app).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, workspace_root.to_string_lossy().to_string())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn recent_workspaces_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<std::path::PathBuf> {
    Ok(app.path().app_data_dir()?.join("recent_workspaces.json"))
}

fn read_recent_workspaces<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<String> {
    let path = match recent_workspaces_path(app) {
        Ok(path) => path,
        Err(_) => return Vec::new(),
    };

    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(_) => return Vec::new(),
    };

    serde_json::from_str::<Vec<String>>(&content).unwrap_or_default()
}

fn persist_recent_workspaces<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    recent: &[String],
) -> Result<(), String> {
    let path = recent_workspaces_path(app).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(recent).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn update_recent_workspaces<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    workspace_root: &std::path::Path,
) -> Result<(), String> {
    let normalized =
        std::fs::canonicalize(workspace_root).unwrap_or_else(|_| workspace_root.to_path_buf());
    let normalized = normalized.to_string_lossy().to_string();

    let mut recent = read_recent_workspaces(app);
    recent.retain(|p| p != &normalized);
    recent.insert(0, normalized);
    recent.truncate(5);

    persist_recent_workspaces(app, &recent)
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    let is_ok = !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if is_ok {
        Ok(())
    } else {
        Err(format!("invalid {label}: {value}"))
    }
}

fn codex_thread_sidecar_dir(workspace_root: &std::path::Path) -> std::path::PathBuf {
    workspace_root
        .join(".agentmesh")
        .join("codex")
        .join("threads")
}

fn codex_thread_sidecar_path(
    workspace_root: &std::path::Path,
    thread_id: &str,
) -> std::path::PathBuf {
    codex_thread_sidecar_dir(workspace_root).join(format!("{thread_id}.json"))
}

fn codex_thread_archive_guard_dir(workspace_root: &std::path::Path) -> std::path::PathBuf {
    workspace_root
        .join(".agentmesh")
        .join("codex")
        .join("archive_guards")
}

fn codex_thread_archive_guard_path(
    workspace_root: &std::path::Path,
    thread_id: &str,
) -> std::path::PathBuf {
    codex_thread_archive_guard_dir(workspace_root).join(format!("{thread_id}.json"))
}

fn truncate_unicode_chars(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let mut out = String::with_capacity(value.len().min(max_chars));
    for (idx, ch) in value.chars().enumerate() {
        if idx >= max_chars {
            break;
        }
        out.push(ch);
    }
    out
}

fn collapse_whitespace_to_single_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_cjk_char(value: char) -> bool {
    matches!(value as u32,
        0x2E80..=0x2EFF // CJK Radicals Supplement
        | 0x3000..=0x303F // CJK Symbols and Punctuation
        | 0x31C0..=0x31EF // CJK Strokes
        | 0x3400..=0x4DBF // CJK Unified Ideographs Extension A
        | 0x4E00..=0x9FFF // CJK Unified Ideographs
        | 0xF900..=0xFAFF // CJK Compatibility Ideographs
        | 0xFF00..=0xFFEF // Halfwidth and Fullwidth Forms
        | 0x20000..=0x2A6DF // CJK Unified Ideographs Extension B
        | 0x2A700..=0x2B73F // Extension C
        | 0x2B740..=0x2B81F // Extension D
        | 0x2B820..=0x2CEAF // Extension E/F
        | 0x2CEB0..=0x2EBEF // Extension G
        | 0x2F800..=0x2FA1F // CJK Compatibility Ideographs Supplement
    )
}

fn truncate_mixed_cjk_or_word(value: &str, max_units: usize) -> String {
    if max_units == 0 {
        return String::new();
    }
    let mut out = String::new();
    let mut units = 0usize;
    let mut chars = value.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch.is_whitespace() {
            if !out.ends_with(' ') && !out.is_empty() {
                out.push(' ');
            }
            continue;
        }

        if is_cjk_char(ch) {
            if units >= max_units {
                break;
            }
            out.push(ch);
            units += 1;
            continue;
        }

        let mut token = String::new();
        token.push(ch);
        while let Some(&next) = chars.peek() {
            if next.is_whitespace() || is_cjk_char(next) {
                break;
            }
            token.push(next);
            chars.next();
        }

        if units >= max_units {
            break;
        }
        units += 1;
        out.push_str(&token);
    }

    out.trim().to_string()
}

fn derive_auto_thread_title_from_preview(preview: &str) -> Option<String> {
    const MARKER_ASCII: &str = "## My request for Codex:";
    const MARKER_FULLWIDTH: &str = "## My request for Codex：";

    let trimmed = preview.trim();
    if trimmed.is_empty() {
        return None;
    }

    let extracted = if let Some(idx) = trimmed.find(MARKER_ASCII) {
        &trimmed[idx + MARKER_ASCII.len()..]
    } else if let Some(idx) = trimmed.find(MARKER_FULLWIDTH) {
        &trimmed[idx + MARKER_FULLWIDTH.len()..]
    } else {
        trimmed
    };

    let normalized = collapse_whitespace_to_single_spaces(extracted)
        .trim()
        .to_string();
    if normalized.is_empty() {
        return None;
    }

    let truncated = truncate_mixed_cjk_or_word(&normalized, 50);
    let final_title = truncated.trim().to_string();
    if final_title.is_empty() {
        None
    } else {
        Some(final_title)
    }
}

fn read_codex_thread_title_sidecar(
    workspace_root: &std::path::Path,
    thread_id: &str,
) -> Option<CodexThreadTitleSidecar> {
    let path = codex_thread_sidecar_path(workspace_root, thread_id);
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<CodexThreadTitleSidecar>(&content).ok()
}

fn write_codex_thread_title_sidecar(
    workspace_root: &std::path::Path,
    thread_id: &str,
    sidecar: &CodexThreadTitleSidecar,
) -> Result<(), String> {
    let dir = codex_thread_sidecar_dir(workspace_root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = codex_thread_sidecar_path(workspace_root, thread_id);
    let json = serde_json::to_string_pretty(sidecar).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_codex_thread_title_sidecar(
    workspace_root: &std::path::Path,
    thread_id: &str,
) -> Result<(), String> {
    let path = codex_thread_sidecar_path(workspace_root, thread_id);
    match std::fs::remove_file(path) {
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

fn read_codex_thread_archive_guard(
    workspace_root: &std::path::Path,
    thread_id: &str,
) -> Option<CodexThreadArchiveGuard> {
    let path = codex_thread_archive_guard_path(workspace_root, thread_id);
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<CodexThreadArchiveGuard>(&content).ok()
}

fn write_codex_thread_archive_guard(
    workspace_root: &std::path::Path,
    thread_id: &str,
    guard: &CodexThreadArchiveGuard,
) -> Result<(), String> {
    let dir = codex_thread_archive_guard_dir(workspace_root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = codex_thread_archive_guard_path(workspace_root, thread_id);
    let json = serde_json::to_string_pretty(guard).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_codex_thread_archive_guard(
    workspace_root: &std::path::Path,
    thread_id: &str,
) -> Result<(), String> {
    let path = codex_thread_archive_guard_path(workspace_root, thread_id);
    match std::fs::remove_file(path) {
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

fn to_epoch_ms(ts: std::time::SystemTime) -> Option<u64> {
    ts.duration_since(std::time::SystemTime::UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
}

fn modified_ms(path: &std::path::Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(to_epoch_ms)
}

fn interaction_count_from_rollout(path: &std::path::Path) -> Option<u32> {
    use std::io::BufRead;

    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);

    let mut user_count: u32 = 0;
    let mut ai_count: u32 = 0;
    let mut ai_pending = false;

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if !line.contains(r#""event_msg""#) && !line.contains(r#""response_item""#) {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let line_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match line_type {
            "event_msg" => {
                let payload = match value.get("payload") {
                    Some(payload) => payload,
                    None => continue,
                };
                let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match event_type {
                    "user_message" => {
                        if ai_pending {
                            ai_count = ai_count.saturating_add(1);
                        }
                        user_count = user_count.saturating_add(1);
                        ai_pending = true;
                    }
                    "turn_complete" | "task_complete" | "turn_aborted" | "error" => {
                        if ai_pending {
                            ai_count = ai_count.saturating_add(1);
                            ai_pending = false;
                        }
                    }
                    _ => {
                        if event_type.starts_with("agent_") {
                            if ai_pending {
                                ai_count = ai_count.saturating_add(1);
                                ai_pending = false;
                            }
                        }
                    }
                }
            }
            "response_item" => {
                if ai_pending {
                    ai_count = ai_count.saturating_add(1);
                    ai_pending = false;
                }
            }
            _ => {}
        }
    }

    Some(user_count.saturating_add(ai_count))
}

fn read_optional_string(path: &std::path::Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn task_agents_dir(workspace_root: &std::path::Path, task_id: &str) -> std::path::PathBuf {
    workspace_root
        .join(".agentmesh")
        .join("tasks")
        .join(task_id)
        .join("agents")
}

fn task_root_dir(workspace_root: &std::path::Path, task_id: &str) -> std::path::PathBuf {
    workspace_root
        .join(".agentmesh")
        .join("tasks")
        .join(task_id)
}

fn task_shared_dir(workspace_root: &std::path::Path, task_id: &str) -> std::path::PathBuf {
    workspace_root
        .join(".agentmesh")
        .join("tasks")
        .join(task_id)
        .join("shared")
}

fn shared_category_dir(
    workspace_root: &std::path::Path,
    task_id: &str,
    category: &str,
) -> Result<std::path::PathBuf, String> {
    validate_id(task_id, "task_id")?;
    let subdir = match category {
        "reports" => "reports",
        "contracts" => "contracts",
        "decisions" => "decisions",
        other => return Err(format!("invalid category: {other}")),
    };
    Ok(task_shared_dir(workspace_root, task_id).join(subdir))
}

fn validate_artifact_rel_path(value: &str) -> Result<std::path::PathBuf, String> {
    if value.trim().is_empty() {
        return Err("artifact path cannot be empty".to_string());
    }
    let path = std::path::PathBuf::from(value);
    if path.is_absolute() {
        return Err("absolute paths are not allowed".to_string());
    }
    for component in path.components() {
        match component {
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err("path traversal is not allowed".to_string())
            }
            _ => {}
        }
    }
    Ok(path)
}

fn validate_task_rel_path(value: &str) -> Result<std::path::PathBuf, String> {
    if value.trim().is_empty() {
        return Err("path cannot be empty".to_string());
    }
    let path = std::path::PathBuf::from(value);
    if path.is_absolute() {
        return Err("absolute paths are not allowed".to_string());
    }
    for component in path.components() {
        match component {
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err("path traversal is not allowed".to_string())
            }
            _ => {}
        }
    }
    Ok(path)
}

fn collect_artifact_summaries(
    base_dir: &std::path::Path,
    current_dir: &std::path::Path,
    out: &mut Vec<SharedArtifactSummary>,
) -> Result<(), String> {
    let read_dir = std::fs::read_dir(current_dir).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_artifact_summaries(base_dir, &path, out)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let rel = path.strip_prefix(base_dir).map_err(|e| e.to_string())?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let filename = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or(&rel_str)
            .to_string();
        let meta = entry.metadata().ok();
        let updated_at_ms = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(to_epoch_ms);
        let size_bytes = meta.as_ref().map(|m| m.len());

        out.push(SharedArtifactSummary {
            path: rel_str,
            filename,
            updated_at_ms,
            size_bytes,
        });
    }
    Ok(())
}

#[tauri::command]
fn cluster_status(state: tauri::State<'_, AppState>) -> agentmesh_core::task::ClusterStatus {
    state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .cluster_status()
}

#[tauri::command]
fn list_tasks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<agentmesh_core::task::TaskFile>, String> {
    state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .list_tasks()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_task(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<agentmesh_core::task::TaskFile, String> {
    state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_task(&task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_task_events(
    state: tauri::State<'_, AppState>,
    task_id: String,
    event_type_prefix: Option<String>,
    limit: usize,
    offset: usize,
) -> Result<Vec<agentmesh_core::task::TaskEvent>, String> {
    state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_task_events(&task_id, event_type_prefix.as_deref(), limit, offset)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn create_task(
    state: tauri::State<'_, AppState>,
    req: agentmesh_core::task::CreateTaskRequest,
) -> Result<agentmesh_core::task::CreateTaskResponse, String> {
    state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .create_task(req)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_subagent_sessions(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Vec<SubagentSessionSummary>, String> {
    validate_id(&task_id, "task_id")?;

    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();
    let agents_dir = task_agents_dir(&workspace_root, &task_id);
    let read_dir = match std::fs::read_dir(&agents_dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.to_string()),
    };

    let mut sessions = Vec::new();

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(agent_instance) = path.file_name().and_then(|v| v.to_str()) else {
            continue;
        };
        if agent_instance.starts_with('.') {
            continue;
        }

        let session_path = path.join("session.json");
        let final_path = path.join("artifacts").join("final.json");
        let events_path = path.join("runtime").join("events.jsonl");

        let adapter = std::fs::read_to_string(&session_path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .and_then(|json| {
                json.get("adapter")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
            });

        let status_from_final = read_optional_string(&final_path)?
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .and_then(|json| {
                json.get("status").and_then(|v| v.as_str()).map(|status| {
                    match status {
                        "success" => "completed",
                        "blocked" => "blocked",
                        "failed" => "failed",
                        _ => "unknown",
                    }
                    .to_string()
                })
            });

        let events_non_empty = std::fs::metadata(&events_path)
            .ok()
            .map(|m| m.len() > 0)
            .unwrap_or(false);

        let status = status_from_final.unwrap_or_else(|| {
            if events_non_empty {
                "running".to_string()
            } else {
                "unknown".to_string()
            }
        });

        let last_updated_at_ms = modified_ms(&events_path)
            .or_else(|| modified_ms(&final_path))
            .or_else(|| modified_ms(&session_path));

        sessions.push(SubagentSessionSummary {
            agent_instance: agent_instance.to_string(),
            status,
            last_updated_at_ms,
            adapter,
            has_final: final_path.exists(),
            has_events: events_path.exists(),
        });
    }

    sessions.sort_by(|a, b| match (a.last_updated_at_ms, b.last_updated_at_ms) {
        (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.agent_instance.cmp(&b.agent_instance),
    });

    Ok(sessions)
}

#[tauri::command]
fn get_subagent_final_output(
    state: tauri::State<'_, AppState>,
    task_id: String,
    agent_instance: String,
) -> Result<SubagentFinalOutput, String> {
    validate_id(&task_id, "task_id")?;
    validate_id(&agent_instance, "agent_instance")?;

    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();
    let agents_dir = task_agents_dir(&workspace_root, &task_id);
    let final_path = agents_dir
        .join(&agent_instance)
        .join("artifacts")
        .join("final.json");

    let content = match read_optional_string(&final_path)? {
        Some(content) => content,
        None => {
            return Ok(SubagentFinalOutput {
                exists: false,
                json: None,
                parse_error: None,
            })
        }
    };

    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(json) => Ok(SubagentFinalOutput {
            exists: true,
            json: Some(json),
            parse_error: None,
        }),
        Err(err) => Ok(SubagentFinalOutput {
            exists: true,
            json: None,
            parse_error: Some(err.to_string()),
        }),
    }
}

#[tauri::command]
fn tail_subagent_events(
    state: tauri::State<'_, AppState>,
    task_id: String,
    agent_instance: String,
    limit: usize,
) -> Result<Vec<String>, String> {
    validate_id(&task_id, "task_id")?;
    validate_id(&agent_instance, "agent_instance")?;

    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();
    let agents_dir = task_agents_dir(&workspace_root, &task_id);
    let events_path = agents_dir
        .join(&agent_instance)
        .join("runtime")
        .join("events.jsonl");

    let content = match read_optional_string(&events_path)? {
        Some(content) => content,
        None => return Ok(Vec::new()),
    };

    let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let start = lines.len().saturating_sub(limit);
    Ok(lines[start..].to_vec())
}

#[tauri::command]
fn tail_subagent_stderr(
    state: tauri::State<'_, AppState>,
    task_id: String,
    agent_instance: String,
    limit: usize,
) -> Result<Vec<String>, String> {
    validate_id(&task_id, "task_id")?;
    validate_id(&agent_instance, "agent_instance")?;

    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();
    let agents_dir = task_agents_dir(&workspace_root, &task_id);
    let stderr_path = agents_dir
        .join(&agent_instance)
        .join("runtime")
        .join("stderr.log");

    let content = match read_optional_string(&stderr_path)? {
        Some(content) => content,
        None => return Ok(Vec::new()),
    };

    let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let start = lines.len().saturating_sub(limit);
    Ok(lines[start..].to_vec())
}

#[tauri::command]
fn task_read_text_file(
    state: tauri::State<'_, AppState>,
    task_id: String,
    path: String,
    max_bytes: Option<usize>,
) -> Result<TaskTextFileContent, String> {
    validate_id(&task_id, "task_id")?;
    let rel_path = validate_task_rel_path(&path)?;

    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();
    let base_dir = task_root_dir(&workspace_root, &task_id);
    let full_path = base_dir.join(&rel_path);

    if !full_path.exists() {
        return Ok(TaskTextFileContent {
            path,
            exists: false,
            content: None,
            updated_at_ms: None,
            size_bytes: None,
            truncated: false,
        });
    }

    let canonical_base = std::fs::canonicalize(&base_dir).map_err(|e| e.to_string())?;
    let canonical_file = std::fs::canonicalize(&full_path).map_err(|e| e.to_string())?;
    if !canonical_file.starts_with(&canonical_base) {
        return Err("path escapes task directory".to_string());
    }

    let meta = std::fs::metadata(&canonical_file).ok();
    let updated_at_ms = modified_ms(&canonical_file);
    let size_bytes = meta.as_ref().map(|m| m.len());

    let raw = std::fs::read_to_string(&canonical_file).map_err(|e| e.to_string())?;
    let limit = max_bytes.unwrap_or(1024 * 1024);
    let truncated = raw.len() > limit;
    let content = if truncated {
        raw.get(0..limit).unwrap_or("").to_string()
    } else {
        raw
    };

    Ok(TaskTextFileContent {
        path,
        exists: true,
        content: Some(content),
        updated_at_ms,
        size_bytes,
        truncated,
    })
}

#[tauri::command]
fn task_list_directory(
    state: tauri::State<'_, AppState>,
    task_id: String,
    relative_path: String,
) -> Result<Vec<TaskDirectoryEntry>, String> {
    validate_id(&task_id, "task_id")?;
    let rel_path = if relative_path.trim().is_empty() {
        std::path::PathBuf::new()
    } else {
        validate_task_rel_path(&relative_path)?
    };

    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();
    let base_dir = task_root_dir(&workspace_root, &task_id);
    let target_dir = if rel_path.as_os_str().is_empty() {
        base_dir.clone()
    } else {
        base_dir.join(&rel_path)
    };

    if !target_dir.exists() || !target_dir.is_dir() {
        return Ok(Vec::new());
    }

    let canonical_base = std::fs::canonicalize(&base_dir).map_err(|e| e.to_string())?;
    let canonical_target = std::fs::canonicalize(&target_dir).map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_base) {
        return Err("path escapes task directory".to_string());
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&canonical_target).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let canonical_entry = match std::fs::canonicalize(&entry_path) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if !canonical_entry.starts_with(&canonical_base) {
            continue;
        }
        let metadata = entry.metadata().ok();
        let is_directory = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size_bytes = if is_directory {
            None
        } else {
            metadata.as_ref().map(|m| m.len())
        };
        let updated_at_ms = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(to_epoch_ms);
        let entry_rel_path = if rel_path.as_os_str().is_empty() {
            entry.file_name().to_string_lossy().to_string()
        } else {
            format!("{}/{}", relative_path, entry.file_name().to_string_lossy())
        };

        entries.push(TaskDirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry_rel_path,
            is_directory,
            size_bytes,
            updated_at_ms,
        });
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
fn workspace_list_directory(
    cwd: String,
    relative_path: String,
) -> Result<Vec<TaskDirectoryEntry>, String> {
    if cwd.trim().is_empty() {
        return Err("cwd cannot be empty".to_string());
    }
    let base_dir = std::path::PathBuf::from(&cwd);
    if !base_dir.exists() || !base_dir.is_dir() {
        return Err("cwd is not a directory".to_string());
    }

    let rel_path = if relative_path.trim().is_empty() {
        std::path::PathBuf::new()
    } else {
        validate_task_rel_path(&relative_path)?
    };

    let target_dir = if rel_path.as_os_str().is_empty() {
        base_dir.clone()
    } else {
        base_dir.join(&rel_path)
    };

    if !target_dir.exists() || !target_dir.is_dir() {
        return Ok(Vec::new());
    }

    let canonical_base = std::fs::canonicalize(&base_dir).map_err(|e| e.to_string())?;
    let canonical_target = std::fs::canonicalize(&target_dir).map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_base) {
        return Err("path escapes workspace root".to_string());
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&canonical_target).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let canonical_entry = match std::fs::canonicalize(&entry_path) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if !canonical_entry.starts_with(&canonical_base) {
            continue;
        }
        let metadata = entry.metadata().ok();
        let is_directory = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size_bytes = if is_directory {
            None
        } else {
            metadata.as_ref().map(|m| m.len())
        };
        let updated_at_ms = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(to_epoch_ms);
        let entry_rel_path = if rel_path.as_os_str().is_empty() {
            entry.file_name().to_string_lossy().to_string()
        } else {
            format!("{}/{}", relative_path, entry.file_name().to_string_lossy())
        };

        entries.push(TaskDirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry_rel_path,
            is_directory,
            size_bytes,
            updated_at_ms,
        });
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
fn workspace_write_file(cwd: String, relative_path: String, content: String) -> Result<(), String> {
    if cwd.trim().is_empty() {
        return Err("cwd cannot be empty".to_string());
    }
    let base_dir = std::path::PathBuf::from(cwd.trim());
    if !base_dir.exists() || !base_dir.is_dir() {
        return Err("cwd is not a directory".to_string());
    }

    let rel_path = validate_task_rel_path(&relative_path)?;
    let target_file = base_dir.join(&rel_path);
    if !target_file.exists() {
        return Err("file does not exist".to_string());
    }
    if !target_file.is_file() {
        return Err("path is not a file".to_string());
    }

    // Limit content size to 1MB (keep parity with read_file_content).
    if content.as_bytes().len() > 1_000_000 {
        return Err("content too large (max 1MB)".to_string());
    }

    let canonical_base = std::fs::canonicalize(&base_dir).map_err(|e| e.to_string())?;
    let canonical_target = std::fs::canonicalize(&target_file).map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_base) {
        return Err("path escapes workspace root".to_string());
    }

    std::fs::write(&canonical_target, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn workspace_rename_file(
    cwd: String,
    from_relative_path: String,
    to_relative_path: String,
) -> Result<(), String> {
    use std::path::Path;

    if cwd.trim().is_empty() {
        return Err("cwd cannot be empty".to_string());
    }
    let base_dir = std::path::PathBuf::from(cwd.trim());
    if !base_dir.exists() || !base_dir.is_dir() {
        return Err("cwd is not a directory".to_string());
    }

    let from_rel = validate_task_rel_path(&from_relative_path)?;
    let to_rel = validate_task_rel_path(&to_relative_path)?;

    // Only allow renaming within the same directory (no moves).
    let from_parent = from_rel.parent().unwrap_or(Path::new(""));
    let to_parent = to_rel.parent().unwrap_or(Path::new(""));
    if from_parent != to_parent {
        return Err("renaming across directories is not allowed".to_string());
    }

    let from_path = base_dir.join(&from_rel);
    if !from_path.exists() {
        return Err("source file does not exist".to_string());
    }
    if !from_path.is_file() {
        return Err("source path is not a file".to_string());
    }

    let canonical_base = std::fs::canonicalize(&base_dir).map_err(|e| e.to_string())?;
    let canonical_from = std::fs::canonicalize(&from_path).map_err(|e| e.to_string())?;
    if !canonical_from.starts_with(&canonical_base) {
        return Err("path escapes workspace root".to_string());
    }

    let to_file_name = to_rel
        .file_name()
        .ok_or_else(|| "destination path must be a file".to_string())?;
    let to_parent_path = base_dir.join(to_parent);
    if !to_parent_path.exists() || !to_parent_path.is_dir() {
        return Err("destination directory does not exist".to_string());
    }
    let canonical_to_parent = std::fs::canonicalize(&to_parent_path).map_err(|e| e.to_string())?;
    if !canonical_to_parent.starts_with(&canonical_base) {
        return Err("path escapes workspace root".to_string());
    }

    let canonical_to = canonical_to_parent.join(to_file_name);
    if canonical_to.exists() {
        return Err("destination already exists".to_string());
    }

    std::fs::rename(&canonical_from, &canonical_to).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_shared_artifacts(
    state: tauri::State<'_, AppState>,
    task_id: String,
    category: String,
) -> Result<Vec<SharedArtifactSummary>, String> {
    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();
    let base_dir = shared_category_dir(&workspace_root, &task_id, &category)?;
    if !base_dir.exists() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    collect_artifact_summaries(&base_dir, &base_dir, &mut items)?;
    items.sort_by(|a, b| match (a.updated_at_ms, b.updated_at_ms) {
        (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.path.cmp(&b.path),
    });

    Ok(items)
}

#[tauri::command]
fn read_shared_artifact(
    state: tauri::State<'_, AppState>,
    task_id: String,
    category: String,
    path: String,
) -> Result<SharedArtifactContent, String> {
    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();
    let base_dir = shared_category_dir(&workspace_root, &task_id, &category)?;
    let rel_path = validate_artifact_rel_path(&path)?;
    let full_path = base_dir.join(&rel_path);
    if !full_path.exists() {
        return Err("artifact not found".to_string());
    }

    let canonical_base = std::fs::canonicalize(&base_dir).map_err(|e| e.to_string())?;
    let canonical_file = std::fs::canonicalize(&full_path).map_err(|e| e.to_string())?;
    if !canonical_file.starts_with(&canonical_base) {
        return Err("artifact path escapes category directory".to_string());
    }

    let content = std::fs::read_to_string(&canonical_file).map_err(|e| e.to_string())?;
    let updated_at_ms = modified_ms(&canonical_file);

    Ok(SharedArtifactContent {
        path,
        content,
        updated_at_ms,
    })
}

fn codex_config_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "HOME directory not found".to_string())?;

    Ok(std::path::PathBuf::from(home)
        .join(".codex")
        .join("config.toml"))
}

fn default_codex_home_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "HOME directory not found".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".codex"))
}

fn rollout_date_parts_from_filename(name: &str) -> Option<(String, String, String)> {
    let core = name.strip_prefix("rollout-")?.strip_suffix(".jsonl")?;
    let (date_part, _) = core.split_once('T')?;
    let mut parts = date_part.split('-');
    let year = parts.next()?;
    let month = parts.next()?;
    let day = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if year.len() != 4 || month.len() != 2 || day.len() != 2 {
        return None;
    }
    Some((year.to_string(), month.to_string(), day.to_string()))
}

fn rollout_thread_id_from_filename(name: &str) -> Option<String> {
    let core = name.strip_prefix("rollout-")?.strip_suffix(".jsonl")?;
    if core.len() < 36 {
        return None;
    }
    let thread_id = &core[core.len() - 36..];
    Some(thread_id.to_string())
}

async fn restore_recent_archived_sessions(
    codex_home: &std::path::Path,
    workspace_root: &std::path::Path,
    max_age: std::time::Duration,
) -> Result<(), String> {
    let archived_dir = codex_home.join("archived_sessions");
    let sessions_dir = codex_home.join("sessions");

    let mut entries = match tokio::fs::read_dir(&archived_dir).await {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    let _ = tokio::fs::create_dir_all(&sessions_dir).await;
    let now = std::time::SystemTime::now();

    while let Ok(Some(entry)) = entries.next_entry().await {
        let file_type = match entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_file() {
            continue;
        }

        let metadata = match entry.metadata().await {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        let modified = match metadata.modified() {
            Ok(time) => time,
            Err(_) => continue,
        };

        let age = now.duration_since(modified).unwrap_or_default();
        if age > max_age {
            continue;
        }

        let file_name = entry.file_name();
        let file_name_str = match file_name.to_str() {
            Some(name) => name,
            None => continue,
        };
        let thread_id = rollout_thread_id_from_filename(file_name_str);
        if let Some(ref thread_id) = thread_id {
            if let Some(guard) = read_codex_thread_archive_guard(workspace_root, thread_id) {
                let modified_ms = to_epoch_ms(modified);
                if modified_ms.is_none() || modified_ms <= Some(guard.archived_at_ms) {
                    continue;
                }
            }
        }
        let destination_dir = match rollout_date_parts_from_filename(file_name_str) {
            Some((year, month, day)) => sessions_dir.join(year).join(month).join(day),
            None => continue,
        };
        let _ = tokio::fs::create_dir_all(&destination_dir).await;
        let destination = destination_dir.join(&file_name);
        if tokio::fs::metadata(&destination).await.is_ok() {
            continue;
        }

        let _ = tokio::fs::rename(entry.path(), &destination).await;
        if let Some(thread_id) = thread_id {
            let _ = remove_codex_thread_archive_guard(workspace_root, &thread_id);
        }
    }

    Ok(())
}

async fn get_or_start_codex(
    state: &tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    app_server_id: Option<String>,
) -> Result<CodexAppServer, String> {
    let cwd = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();

    let mut pool = state.codex_pool.lock().await;

    if let Some(id) = app_server_id.as_deref() {
        return pool
            .get(id)
            .ok_or_else(|| format!("unknown appServerId: {id}"));
    }

    let codex_home = default_codex_home_dir()?;
    let profile = { state.codex_profile.lock().await.clone() };
    let id = pool.ensure(app, &cwd, &codex_home, profile).await?;
    pool.get(&id)
        .ok_or_else(|| "codex app-server pool internal error: missing server".to_string())
}

#[tauri::command]
fn workspace_root_get(state: tauri::State<'_, AppState>) -> Result<String, String> {
    Ok(state
        .orchestrator
        .lock()
        .map_err(|_| "orchestrator lock poisoned".to_string())?
        .workspace_root()
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
async fn workspace_root_set(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    workspace_root: String,
) -> Result<String, String> {
    let root = std::path::PathBuf::from(workspace_root.trim());
    if root.as_os_str().is_empty() {
        return Err("workspace_root cannot be empty".to_string());
    }

    if root.exists() && !root.is_dir() {
        return Err("workspace_root must be a directory".to_string());
    }

    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    persist_workspace_root(&app, &root)?;
    update_recent_workspaces(&app, &root)?;

    {
        let mut pool = state.codex_pool.lock().await;
        pool.shutdown_all().await;
    }

    {
        let mut orchestrator = state
            .orchestrator
            .lock()
            .map_err(|_| "orchestrator lock poisoned".to_string())?;
        *orchestrator = agentmesh_orchestrator::Orchestrator::new(root.clone());
    }

    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn workspace_recent_list(app: tauri::AppHandle) -> Vec<String> {
    read_recent_workspaces(&app)
}

#[tauri::command]
fn window_new(app: tauri::AppHandle) -> Result<String, String> {
    let id = NEXT_WINDOW_ID.fetch_add(1, Ordering::SeqCst);
    let label = format!("main-{id}");

    tauri::WebviewWindowBuilder::new(&app, label.clone(), tauri::WebviewUrl::default())
        .title("AgentMesh")
        .inner_size(900.0, 650.0)
        .min_inner_size(900.0, 650.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(label)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAppServerEnsureResponse {
    app_server_id: String,
}

#[tauri::command]
async fn codex_app_server_ensure(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    codex_home: Option<String>,
    profile: Option<String>,
) -> Result<CodexAppServerEnsureResponse, String> {
    let cwd = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();

    let codex_home = codex_home
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or(default_codex_home_dir()?);

    let profile = profile
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let profile = match profile {
        Some(p) => Some(p),
        None => state.codex_profile.lock().await.clone(),
    };

    let mut pool = state.codex_pool.lock().await;
    let app_server_id = pool.ensure(app, &cwd, &codex_home, profile).await?;
    Ok(CodexAppServerEnsureResponse { app_server_id })
}

#[tauri::command]
async fn codex_app_server_shutdown(
    state: tauri::State<'_, AppState>,
    app_server_id: String,
) -> Result<(), String> {
    let mut pool = state.codex_pool.lock().await;
    pool.shutdown(&app_server_id).await;
    Ok(())
}

#[tauri::command]
async fn codex_thread_list(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    cursor: Option<String>,
    limit: Option<u32>,
    cwd_filter: Option<String>,
    pinned_thread_id: Option<String>,
    app_server_id: Option<String>,
) -> Result<CodexThreadListResponse, String> {
    // Get current workspace for filtering
    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();

    let filter_path = cwd_filter
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| workspace_root.clone());

    let codex_home = default_codex_home_dir()?;
    let _ = restore_recent_archived_sessions(
        &codex_home,
        &workspace_root,
        std::time::Duration::from_secs(3 * 60),
    )
    .await;

    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let params = serde_json::json!({
        "cursor": cursor,
        "limit": limit,
    });

    let result = codex.request("thread/list", Some(params)).await?;
    let data = result
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "invalid thread/list response: data".to_string())?;
    let next_cursor = result
        .get("nextCursor")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    let mut threads = Vec::with_capacity(data.len());
    for entry in data {
        let Some(id) = entry.get("id").and_then(|v| v.as_str()) else {
            continue;
        };

        // Parse cwd from entry for workspace filtering
        let thread_cwd = entry
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(std::path::PathBuf::from);

        // Filter: skip threads not in requested cwd unless pinned (threads without cwd remain visible)
        let is_pinned = pinned_thread_id.as_deref() == Some(id);
        if !is_pinned {
            if let Some(ref cwd) = thread_cwd {
                if !paths_match(cwd, &filter_path) {
                    continue;
                }
            }
        }

        let preview = entry
            .get("preview")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let mut title: Option<String> = None;
        if let Some(sidecar) = read_codex_thread_title_sidecar(&workspace_root, id) {
            if sidecar.source == "manual" {
                let raw = sidecar.title.trim();
                if !raw.is_empty() {
                    let trimmed = truncate_unicode_chars(raw, 50).trim().to_string();
                    if !trimmed.is_empty() {
                        title = Some(trimmed);
                    }
                }
            }
        }

        if title.is_none() {
            if let Some(auto) = derive_auto_thread_title_from_preview(&preview) {
                title = Some(auto);
            }
        }

        let model_provider = entry
            .get("modelProvider")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let created_at = entry.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let thread_path = entry
            .get("path")
            .and_then(|v| v.as_str())
            .map(std::path::PathBuf::from);
        let updated_at_ms = thread_path.as_deref().and_then(modified_ms);
        let interaction_count = thread_path
            .as_deref()
            .and_then(interaction_count_from_rollout);

        threads.push(CodexThreadSummary {
            id: id.to_string(),
            preview,
            title,
            model_provider,
            created_at,
            updated_at_ms,
            interaction_count,
        });
    }

    threads.sort_by(|a, b| match (a.updated_at_ms, b.updated_at_ms) {
        (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.created_at.cmp(&a.created_at),
    });

    if let Some(pinned_id) = pinned_thread_id.as_deref() {
        if let Some(idx) = threads.iter().position(|t| t.id == pinned_id) {
            if idx != 0 {
                let pinned = threads.remove(idx);
                threads.insert(0, pinned);
            }
        }
    }

    Ok(CodexThreadListResponse {
        data: threads,
        next_cursor,
    })
}

#[tauri::command]
fn codex_thread_title_set(
    state: tauri::State<'_, AppState>,
    thread_id: String,
    title: String,
) -> Result<(), String> {
    validate_id(&thread_id, "thread_id")?;

    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();

    let collapsed = collapse_whitespace_to_single_spaces(title.trim());
    let truncated = truncate_unicode_chars(collapsed.trim(), 50)
        .trim()
        .to_string();
    if truncated.is_empty() {
        return Err("title must not be empty".to_string());
    }

    let sidecar = CodexThreadTitleSidecar {
        title: truncated,
        source: "manual".to_string(),
        updated_at_ms: to_epoch_ms(std::time::SystemTime::now()),
    };
    write_codex_thread_title_sidecar(&workspace_root, &thread_id, &sidecar)?;
    Ok(())
}

#[tauri::command]
async fn codex_thread_archive(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    thread_id: String,
    app_server_id: Option<String>,
) -> Result<(), String> {
    validate_id(&thread_id, "thread_id")?;

    let workspace_root = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_path_buf();

    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let params = serde_json::json!({ "threadId": thread_id.clone() });
    let _ = codex.request("thread/archive", Some(params)).await?;

    if let Some(archived_at_ms) = to_epoch_ms(std::time::SystemTime::now()) {
        let guard = CodexThreadArchiveGuard { archived_at_ms };
        let _ = write_codex_thread_archive_guard(&workspace_root, &thread_id, &guard);
    }

    // Best-effort: ignore sidecar cleanup failures.
    let _ = remove_codex_thread_title_sidecar(&workspace_root, &thread_id);
    Ok(())
}

#[tauri::command]
async fn codex_thread_loaded_list(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    cursor: Option<String>,
    limit: Option<u32>,
    app_server_id: Option<String>,
) -> Result<CodexThreadLoadedListResponse, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let params = serde_json::json!({
        "cursor": cursor,
        "limit": limit,
    });

    let result = codex.request("thread/loaded/list", Some(params)).await?;
    let data = result
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "invalid thread/loaded/list response: data".to_string())?;
    let next_cursor = result
        .get("nextCursor")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    let mut thread_ids = Vec::with_capacity(data.len());
    for entry in data {
        if let Some(thread_id) = entry.as_str() {
            thread_ids.push(thread_id.to_string());
        }
    }

    Ok(CodexThreadLoadedListResponse {
        data: thread_ids,
        next_cursor,
    })
}

#[tauri::command]
async fn codex_thread_start(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    model: Option<String>,
    cwd: Option<String>,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let default_cwd = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_string_lossy()
        .to_string();
    let cwd = cwd
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .unwrap_or(default_cwd);
    let params = serde_json::json!({
        "cwd": cwd,
        "model": model,
    });

    codex.request("thread/start", Some(params)).await
}

#[tauri::command]
async fn codex_thread_resume(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    thread_id: String,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let params = serde_json::json!({ "threadId": thread_id });
    let res = codex.request("thread/resume", Some(params)).await?;
    codex_rollout_restore::augment_thread_resume_response(res, &thread_id).await
}

#[tauri::command]
async fn codex_thread_fork(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    thread_id: String,
    path: Option<String>,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;

    let cwd = state
        .orchestrator
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .workspace_root()
        .to_string_lossy()
        .to_string();

    let mut params = serde_json::json!({ "threadId": thread_id, "cwd": cwd });
    if let Some(path) = path {
        params["path"] = serde_json::Value::String(path);
    }
    let res = codex.request("thread/fork", Some(params)).await?;
    let new_thread_id = res
        .get("thread")
        .and_then(|t| t.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if new_thread_id.is_empty() {
        return Err("invalid thread/fork response: thread.id".to_string());
    }

    codex_rollout_restore::augment_thread_resume_response(res, &new_thread_id).await
}

#[tauri::command]
async fn codex_thread_rollback(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    thread_id: String,
    num_turns: Option<u32>,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;

    let num_turns = num_turns.unwrap_or(1);
    if num_turns < 1 {
        return Err("numTurns must be >= 1".to_string());
    }

    let params = serde_json::json!({ "threadId": thread_id, "numTurns": num_turns });
    let res = codex.request("thread/rollback", Some(params)).await?;
    let resolved_thread_id = res
        .get("thread")
        .and_then(|t| t.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if resolved_thread_id.is_empty() {
        return Err("invalid thread/rollback response: thread.id".to_string());
    }

    codex_rollout_restore::augment_thread_resume_response(res, &resolved_thread_id).await
}

#[tauri::command]
async fn codex_turn_start(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    thread_id: String,
    input: Vec<serde_json::Value>,
    model: Option<String>,
    effort: Option<String>,
    approval_policy: Option<String>,
    cwd: Option<String>,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;

    let effort = match effort.as_deref() {
        None => None,
        Some("") => None,
        Some(v) => Some(v.to_string()),
    };

    let approval_policy = match approval_policy.as_deref() {
        None => None,
        Some("") => None,
        Some(v) => {
            let v = v.to_string();
            match v.as_str() {
                "untrusted" | "on-failure" | "on-request" | "never" => Some(v),
                _ => return Err(format!("invalid approval_policy: {v}")),
            }
        }
    };

    let cwd = cwd
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());

    let params = serde_json::json!({
        "threadId": thread_id,
        "input": input,
        "model": model,
        "effort": effort,
        "approvalPolicy": approval_policy,
        "cwd": cwd,
    });

    codex.request("turn/start", Some(params)).await
}

#[tauri::command]
async fn codex_turn_interrupt(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    thread_id: String,
    turn_id: String,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let params = serde_json::json!({ "threadId": thread_id, "turnId": turn_id });
    codex.request("turn/interrupt", Some(params)).await
}

#[tauri::command]
async fn codex_respond_approval(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    request_id: i64,
    decision: String,
    app_server_id: Option<String>,
) -> Result<(), String> {
    let decision = decision.to_lowercase();
    if decision != "accept" && decision != "decline" {
        return Err("decision must be accept or decline".to_string());
    }

    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    codex
        .respond(request_id, serde_json::json!({ "decision": decision }))
        .await
}

#[tauri::command]
async fn codex_model_list(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    cursor: Option<String>,
    limit: Option<u32>,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let params = serde_json::json!({ "cursor": cursor, "limit": limit });
    codex.request("model/list", Some(params)).await
}

#[tauri::command]
async fn codex_config_read_effective(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    include_layers: Option<bool>,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let params = serde_json::json!({
        "includeLayers": include_layers.unwrap_or(false),
    });
    codex.request("config/read", Some(params)).await
}

#[tauri::command]
async fn codex_config_write_chat_defaults(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    model: Option<String>,
    model_reasoning_effort: Option<String>,
    approval_policy: Option<String>,
    profile: Option<String>,
    app_server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;

    let approval_policy = match approval_policy.as_deref() {
        None => None,
        Some("") => None,
        Some(v) => {
            let v = v.to_string();
            match v.as_str() {
                "untrusted" | "on-failure" | "on-request" | "never" => Some(v),
                _ => return Err(format!("invalid approval_policy: {v}")),
            }
        }
    };

    let model = model.filter(|v| !v.trim().is_empty());
    let model_reasoning_effort = model_reasoning_effort.filter(|v| !v.trim().is_empty());
    let profile = profile
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let key_path = |key: &str| match profile.as_deref() {
        Some(profile) => format!("profiles.{profile}.{key}"),
        None => key.to_string(),
    };

    let mut edits = Vec::new();
    if let Some(model) = model {
        edits.push(serde_json::json!({
            "keyPath": key_path("model"),
            "value": model,
            "mergeStrategy": "replace",
        }));
    }
    if let Some(effort) = model_reasoning_effort {
        edits.push(serde_json::json!({
            "keyPath": key_path("model_reasoning_effort"),
            "value": effort,
            "mergeStrategy": "replace",
        }));
    }
    if let Some(policy) = approval_policy {
        edits.push(serde_json::json!({
            "keyPath": key_path("approval_policy"),
            "value": policy,
            "mergeStrategy": "replace",
        }));
    }

    if edits.is_empty() {
        return Ok(serde_json::json!({ "status": "noop" }));
    }

    let params = serde_json::json!({
        "edits": edits,
    });

    codex.request("config/batchWrite", Some(params)).await
}

#[tauri::command]
async fn codex_set_profile(
    state: tauri::State<'_, AppState>,
    profile: Option<String>,
) -> Result<(), String> {
    let normalized = profile
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    {
        let mut active_profile = state.codex_profile.lock().await;
        if *active_profile == normalized {
            return Ok(());
        }
        *active_profile = normalized;
    }

    // Profile is currently treated as a GUI-global setting. For safety, only restart the
    // default CODEX_HOME-scoped app-server instance.
    let codex_home = default_codex_home_dir()?;
    let mut pool = state.codex_pool.lock().await;
    pool.shutdown_by_codex_home(&codex_home).await;

    Ok(())
}

#[tauri::command]
fn codex_read_config() -> Result<String, String> {
    let path = codex_config_path()?;
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn codex_write_config(content: String) -> Result<(), String> {
    let path = codex_config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn codex_diagnostics() -> CodexDiagnostics {
    codex_app_server::codex_diagnostics().await
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillMetadata {
    name: String,
    description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    short_description: Option<String>,
    path: String,
    scope: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsListResponse {
    skills: Vec<SkillMetadata>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptMetadata {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    argument_hint: Option<String>,
    path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptsListResponse {
    prompts: Vec<PromptMetadata>,
}

#[tauri::command]
async fn codex_skill_list(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    app_server_id: Option<String>,
) -> Result<SkillsListResponse, String> {
    let codex = get_or_start_codex(&state, app, app_server_id).await?;
    let params = serde_json::json!({});

    let result = codex.request("skills/list", Some(params)).await?;
    let data = result
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "invalid skills/list response: data".to_string())?;

    let mut skills = Vec::new();
    for entry in data {
        let Some(entry_skills) = entry.get("skills").and_then(|v| v.as_array()) else {
            continue;
        };
        for skill in entry_skills {
            let Some(name) = skill.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            let description = skill
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let short_description = skill
                .get("shortDescription")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let path = skill
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let scope = skill
                .get("scope")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string();

            skills.push(SkillMetadata {
                name: name.to_string(),
                description,
                short_description,
                path,
                scope,
            });
        }
    }

    Ok(SkillsListResponse { skills })
}

#[tauri::command]
fn codex_prompt_list() -> Result<PromptsListResponse, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "HOME directory not found".to_string())?;

    let prompts_dir = std::path::PathBuf::from(home)
        .join(".codex")
        .join("prompts");

    if !prompts_dir.exists() {
        return Ok(PromptsListResponse { prompts: vec![] });
    }

    let mut prompts = Vec::new();

    let read_dir = match std::fs::read_dir(&prompts_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(PromptsListResponse { prompts: vec![] }),
    };

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let extension = path.extension().and_then(|e| e.to_str());
        if extension != Some("md") {
            continue;
        }

        let name = match path.file_stem().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Parse YAML frontmatter
        let (description, argument_hint) = parse_prompt_frontmatter(&content);

        prompts.push(PromptMetadata {
            name,
            description,
            argument_hint,
            path: path.to_string_lossy().to_string(),
        });
    }

    // Sort by name
    prompts.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(PromptsListResponse { prompts })
}

fn parse_prompt_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }

    let after_start = &trimmed[3..];
    let end_pos = after_start.find("\n---");
    let frontmatter = match end_pos {
        Some(pos) => &after_start[..pos],
        None => return (None, None),
    };

    let mut description = None;
    let mut argument_hint = None;

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("description:") {
            description = Some(rest.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(rest) = line.strip_prefix("argument-hint:") {
            argument_hint = Some(rest.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }

    (description, argument_hint)
}

// ============================================================================
// Context management commands for Auto context, + button, / button
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    path: String,
    name: String,
    is_directory: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatus {
    branch: String,
    modified: Vec<String>,
    staged: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoContextInfo {
    cwd: String,
    recent_files: Vec<String>,
    git_status: Option<GitStatus>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeInfo {
    path: String,
    branch: Option<String>,
}

#[tauri::command]
async fn search_workspace_files(
    cwd: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<FileInfo>, String> {
    use std::path::Path;

    let cwd_path = Path::new(&cwd);
    if !cwd_path.exists() {
        return Err("cwd does not exist".to_string());
    }

    let limit = limit.unwrap_or(10) as usize;
    let query_lower = query.to_lowercase();

    let mut results = Vec::new();
    search_files_recursive(cwd_path, cwd_path, &query_lower, limit, &mut results)?;

    Ok(results)
}

fn search_files_recursive(
    base: &std::path::Path,
    current: &std::path::Path,
    query: &str,
    limit: usize,
    results: &mut Vec<FileInfo>,
) -> Result<(), String> {
    if results.len() >= limit {
        return Ok(());
    }

    let entries = match std::fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        if results.len() >= limit {
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        // Skip hidden files and common ignore patterns
        if file_name.starts_with('.')
            || file_name == "node_modules"
            || file_name == "target"
            || file_name == "dist"
            || file_name == "build"
        {
            continue;
        }

        let is_dir = path.is_dir();
        let rel_path = path
            .strip_prefix(base)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_name.clone());

        // Match if query is empty or file name contains query
        if query.is_empty() || file_name.to_lowercase().contains(query) {
            results.push(FileInfo {
                path: rel_path.clone(),
                name: file_name.clone(),
                is_directory: is_dir,
            });
        }

        // Recurse into directories
        if is_dir && results.len() < limit {
            search_files_recursive(base, &path, query, limit, results)?;
        }
    }

    Ok(())
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    use std::path::Path;

    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err("file does not exist".to_string());
    }

    if !file_path.is_file() {
        return Err("path is not a file".to_string());
    }

    // Limit file size to 1MB
    let metadata = std::fs::metadata(file_path).map_err(|e| e.to_string())?;
    if metadata.len() > 1_000_000 {
        return Err("file too large (max 1MB)".to_string());
    }

    // Read file as bytes and safely convert to UTF-8, replacing invalid sequences
    let bytes = std::fs::read(file_path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
async fn get_auto_context(cwd: String) -> Result<AutoContextInfo, String> {
    use std::path::Path;

    let cwd_path = Path::new(&cwd);
    if !cwd_path.exists() {
        return Err("cwd does not exist".to_string());
    }

    // Get recent files (modified in last 24 hours)
    let recent_files = get_recent_files(cwd_path, 10);

    // Get git status
    let git_status = get_git_status(cwd_path);

    Ok(AutoContextInfo {
        cwd,
        recent_files,
        git_status,
    })
}

fn ensure_git_repo(cwd: &std::path::Path) -> Result<(), String> {
    let output = run_git_command(cwd, &["rev-parse", "--is-inside-work-tree"])?;
    if output.trim() == "true" {
        Ok(())
    } else {
        Err("not a git repository".to_string())
    }
}

fn run_git_command(cwd: &std::path::Path, args: &[&str]) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git command failed".to_string()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn git_worktree_list(cwd: String) -> Result<Vec<WorktreeInfo>, String> {
    let cwd_path = std::path::PathBuf::from(cwd.trim());
    if cwd_path.as_os_str().is_empty() {
        return Err("cwd cannot be empty".to_string());
    }
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err("cwd is not a directory".to_string());
    }
    ensure_git_repo(&cwd_path)?;

    let output = run_git_command(&cwd_path, &["worktree", "list", "--porcelain"])?;
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for raw_line in output.lines() {
        let line = raw_line.trim();
        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(path) = current_path.take() {
                worktrees.push(WorktreeInfo {
                    path,
                    branch: current_branch.take(),
                });
            }
            current_path = Some(rest.trim().to_string());
            current_branch = None;
        } else if let Some(rest) = line.strip_prefix("branch ") {
            let trimmed = rest.trim();
            let branch = trimmed.strip_prefix("refs/heads/").unwrap_or(trimmed);
            current_branch = Some(branch.to_string());
        } else if line == "detached" {
            current_branch = None;
        }
    }

    if let Some(path) = current_path.take() {
        worktrees.push(WorktreeInfo {
            path,
            branch: current_branch.take(),
        });
    }

    Ok(worktrees)
}

#[tauri::command]
async fn git_branch_list(cwd: String) -> Result<Vec<String>, String> {
    let cwd_path = std::path::PathBuf::from(cwd.trim());
    if cwd_path.as_os_str().is_empty() {
        return Err("cwd cannot be empty".to_string());
    }
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err("cwd is not a directory".to_string());
    }
    ensure_git_repo(&cwd_path)?;

    let output = run_git_command(
        &cwd_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;
    let mut branches: Vec<String> = output
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    branches.sort();
    Ok(branches)
}

#[tauri::command]
async fn git_worktree_create(cwd: String, worktree_name: String, branch: String) -> Result<String, String> {
    let cwd_path = std::path::PathBuf::from(cwd.trim());
    if cwd_path.as_os_str().is_empty() {
        return Err("cwd cannot be empty".to_string());
    }
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err("cwd is not a directory".to_string());
    }
    ensure_git_repo(&cwd_path)?;

    let trimmed_name = worktree_name.trim();
    if trimmed_name.is_empty() {
        return Err("worktree name cannot be empty".to_string());
    }
    if trimmed_name.contains('/') || trimmed_name.contains('\\') {
        return Err("worktree name cannot contain path separators".to_string());
    }

    let repo_root = run_git_command(&cwd_path, &["rev-parse", "--show-toplevel"])?;
    let repo_root = std::path::PathBuf::from(repo_root.trim());
    let repo_name = repo_root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "failed to resolve repo name".to_string())?;
    let parent = repo_root
        .parent()
        .ok_or_else(|| "failed to resolve repo parent".to_string())?;
    let target_path = parent.join(format!("{repo_name}-{trimmed_name}"));
    if target_path.exists() {
        return Err("target worktree path already exists".to_string());
    }

    let branch_name = branch.trim();
    if branch_name.is_empty() {
        return Err("branch cannot be empty".to_string());
    }

    let target_str = target_path.to_string_lossy().to_string();
    run_git_command(
        &cwd_path,
        &["worktree", "add", &target_str, branch_name],
    )?;

    Ok(target_str)
}

fn get_recent_files(cwd: &std::path::Path, limit: usize) -> Vec<String> {
    use std::time::{Duration, SystemTime};

    let mut files: Vec<(String, SystemTime)> = Vec::new();
    let cutoff = SystemTime::now() - Duration::from_secs(24 * 60 * 60);

    collect_recent_files(cwd, cwd, &cutoff, &mut files);

    // Sort by modification time (most recent first)
    files.sort_by(|a, b| b.1.cmp(&a.1));

    files
        .into_iter()
        .take(limit)
        .map(|(path, _)| path)
        .collect()
}

fn collect_recent_files(
    base: &std::path::Path,
    current: &std::path::Path,
    cutoff: &std::time::SystemTime,
    files: &mut Vec<(String, std::time::SystemTime)>,
) {
    let entries = match std::fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => continue,
        };

        // Skip hidden files and common ignore patterns
        if file_name.starts_with('.')
            || file_name == "node_modules"
            || file_name == "target"
            || file_name == "dist"
            || file_name == "build"
        {
            continue;
        }

        if path.is_dir() {
            collect_recent_files(base, &path, cutoff, files);
        } else if path.is_file() {
            if let Ok(metadata) = std::fs::metadata(&path) {
                if let Ok(modified) = metadata.modified() {
                    if modified > *cutoff {
                        let rel_path = path
                            .strip_prefix(base)
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_default();
                        if !rel_path.is_empty() {
                            files.push((rel_path, modified));
                        }
                    }
                }
            }
        }
    }
}

fn normalize_for_path_compare(path: &std::path::Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut out = resolved.to_string_lossy().to_string();
    if cfg!(windows) {
        out = out.to_lowercase();
    }
    out
}

fn paths_match(a: &std::path::Path, b: &std::path::Path) -> bool {
    normalize_for_path_compare(a) == normalize_for_path_compare(b)
}

fn get_git_status(cwd: &std::path::Path) -> Option<GitStatus> {
    use std::process::Command;

    // Check if it's a git repo
    let git_dir = cwd.join(".git");
    if !git_dir.exists() {
        return None;
    }

    // Get current branch
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()?;

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    // Get modified files (unstaged)
    let modified_output = Command::new("git")
        .args(["diff", "--name-only"])
        .current_dir(cwd)
        .output()
        .ok()?;

    let modified: Vec<String> = String::from_utf8_lossy(&modified_output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    // Get staged files
    let staged_output = Command::new("git")
        .args(["diff", "--cached", "--name-only"])
        .current_dir(cwd)
        .output()
        .ok()?;

    let staged: Vec<String> = String::from_utf8_lossy(&staged_output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    Some(GitStatus {
        branch,
        modified,
        staged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_title_extracts_marker_and_truncates_50_units() {
        let preview = "prefix\n## My request for Codex:\n12345678901234567890\nsuffix";
        let title = derive_auto_thread_title_from_preview(preview).unwrap();
        assert_eq!(title, "12345678901234567890 suffix");
    }

    #[test]
    fn auto_title_supports_fullwidth_colon_marker() {
        let preview = "## My request for Codex：\nabcdefg hijklmnop";
        let title = derive_auto_thread_title_from_preview(preview).unwrap();
        // whitespace gets collapsed, then truncated to 50 units (input is shorter)
        assert_eq!(title, "abcdefg hijklmnop");
    }

    #[test]
    fn auto_title_counts_cjk_chars_and_english_words() {
        let preview = "## My request for Codex:\n你好 world, this is AI";
        let title = derive_auto_thread_title_from_preview(preview).unwrap();
        // 2 CJK chars + 4 English words => within 50 units
        assert_eq!(title, "你好 world, this is AI");
    }

    #[test]
    fn auto_title_returns_none_for_empty_preview() {
        assert_eq!(derive_auto_thread_title_from_preview("   "), None);
    }
}
