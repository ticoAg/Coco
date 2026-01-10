use tauri::Manager;

mod codex_app_server;

use codex_app_server::CodexAppServer;
use codex_app_server::CodexDiagnostics;
use tokio::sync::Mutex;

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
struct CodexThreadSummary {
    id: String,
    preview: String,
    model_provider: String,
    created_at: i64,
    updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadListResponse {
    data: Vec<CodexThreadSummary>,
    next_cursor: Option<String>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            cluster_status,
            list_tasks,
            get_task,
            get_task_events,
            create_task,
            list_subagent_sessions,
            get_subagent_final_output,
            tail_subagent_events,
            list_shared_artifacts,
            read_shared_artifact,
            codex_thread_list,
            codex_thread_start,
            codex_thread_resume,
            codex_turn_start,
            codex_turn_interrupt,
            codex_respond_approval,
            codex_model_list,
            codex_read_config,
            codex_write_config,
            codex_diagnostics,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let app_handle = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    let server = {
                        let mut guard = state.codex.lock().await;
                        guard.take()
                    };
                    if let Some(server) = server {
                        server.shutdown().await;
                    }
                });
            }
        })
        .setup(|app| {
            let workspace_root = resolve_workspace_root(app.handle())?;
            app.manage(AppState {
                orchestrator: agentmesh_orchestrator::Orchestrator::new(workspace_root),
                codex: Mutex::new(None),
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
    orchestrator: agentmesh_orchestrator::Orchestrator,
    codex: Mutex<Option<CodexAppServer>>,
}

fn resolve_workspace_root<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<std::path::PathBuf> {
    if let Ok(root) = std::env::var("AGENTMESH_WORKSPACE_ROOT") {
        let path = std::path::PathBuf::from(root);
        std::fs::create_dir_all(&path)?;
        return Ok(path);
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
        let rel = path
            .strip_prefix(base_dir)
            .map_err(|e| e.to_string())?;
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
    state.orchestrator.cluster_status()
}

#[tauri::command]
fn list_tasks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<agentmesh_core::task::TaskFile>, String> {
    state.orchestrator.list_tasks().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_task(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<agentmesh_core::task::TaskFile, String> {
    state
        .orchestrator
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
        .create_task(req)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_subagent_sessions(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Vec<SubagentSessionSummary>, String> {
    validate_id(&task_id, "task_id")?;

    let agents_dir = task_agents_dir(state.orchestrator.workspace_root(), &task_id);
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

    let agents_dir = task_agents_dir(state.orchestrator.workspace_root(), &task_id);
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

    let agents_dir = task_agents_dir(state.orchestrator.workspace_root(), &task_id);
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
fn list_shared_artifacts(
    state: tauri::State<'_, AppState>,
    task_id: String,
    category: String,
) -> Result<Vec<SharedArtifactSummary>, String> {
    let base_dir = shared_category_dir(state.orchestrator.workspace_root(), &task_id, &category)?;
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
    let base_dir = shared_category_dir(state.orchestrator.workspace_root(), &task_id, &category)?;
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

async fn get_or_start_codex(
    state: &tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<CodexAppServer, String> {
    let mut guard = state.codex.lock().await;
    if let Some(server) = guard.clone() {
        return Ok(server);
    }

    let cwd = state.orchestrator.workspace_root().to_path_buf();
    let server = CodexAppServer::spawn(app, &cwd).await?;
    *guard = Some(server.clone());
    Ok(server)
}

#[tauri::command]
async fn codex_thread_list(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<CodexThreadListResponse, String> {
    let codex = get_or_start_codex(&state, app).await?;
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
        let preview = entry
            .get("preview")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let model_provider = entry
            .get("modelProvider")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let created_at = entry.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let updated_at_ms = entry
            .get("path")
            .and_then(|v| v.as_str())
            .map(std::path::PathBuf::from)
            .as_deref()
            .and_then(modified_ms);

        threads.push(CodexThreadSummary {
            id: id.to_string(),
            preview,
            model_provider,
            created_at,
            updated_at_ms,
        });
    }

    threads.sort_by(|a, b| match (a.updated_at_ms, b.updated_at_ms) {
        (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.created_at.cmp(&a.created_at),
    });

    Ok(CodexThreadListResponse {
        data: threads,
        next_cursor,
    })
}

#[tauri::command]
async fn codex_thread_start(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app).await?;
    let cwd = state.orchestrator.workspace_root().to_string_lossy().to_string();
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
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app).await?;
    let params = serde_json::json!({ "threadId": thread_id });
    codex.request("thread/resume", Some(params)).await
}

#[tauri::command]
async fn codex_turn_start(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    approval_policy: Option<String>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app).await?;

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

    let params = serde_json::json!({
        "threadId": thread_id,
        "input": [
            { "type": "text", "text": text }
        ],
        "model": model,
        "effort": effort,
        "approvalPolicy": approval_policy,
    });

    codex.request("turn/start", Some(params)).await
}

#[tauri::command]
async fn codex_turn_interrupt(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    thread_id: String,
    turn_id: String,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app).await?;
    let params = serde_json::json!({ "threadId": thread_id, "turnId": turn_id });
    codex.request("turn/interrupt", Some(params)).await
}

#[tauri::command]
async fn codex_respond_approval(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    request_id: i64,
    decision: String,
) -> Result<(), String> {
    let decision = decision.to_lowercase();
    if decision != "accept" && decision != "decline" {
        return Err("decision must be accept or decline".to_string());
    }

    let codex = get_or_start_codex(&state, app).await?;
    codex.respond(request_id, serde_json::json!({ "decision": decision }))
        .await
}

#[tauri::command]
async fn codex_model_list(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let codex = get_or_start_codex(&state, app).await?;
    let params = serde_json::json!({ "cursor": cursor, "limit": limit });
    codex.request("model/list", Some(params)).await
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
