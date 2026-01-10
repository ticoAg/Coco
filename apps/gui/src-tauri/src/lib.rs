use tauri::Manager;

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
        ])
        .setup(|app| {
            let workspace_root = resolve_workspace_root(app.handle())?;
            app.manage(AppState {
                orchestrator: agentmesh_orchestrator::Orchestrator::new(workspace_root),
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

#[derive(Clone)]
struct AppState {
    orchestrator: agentmesh_orchestrator::Orchestrator,
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

fn task_agents_dir(workspace_root: &std::path::Path, task_id: &str) -> std::path::PathBuf {
    workspace_root
        .join(".agentmesh")
        .join("tasks")
        .join(task_id)
        .join("agents")
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
            .and_then(|json| json.get("adapter").and_then(|v| v.as_str()).map(|v| v.to_string()));

        let status_from_final = match std::fs::read_to_string(&final_path) {
            Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json) => {
                    json.get("status").and_then(|v| v.as_str()).map(|status| {
                        match status {
                            "success" => "completed",
                            "blocked" => "blocked",
                            "failed" => "failed",
                            _ => "unknown",
                        }
                        .to_string()
                    })
                }
                Err(_) => None,
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
            Err(err) => return Err(err.to_string()),
        };

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

    sessions.sort_by(|a, b| {
        match (a.last_updated_at_ms, b.last_updated_at_ms) {
            (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.agent_instance.cmp(&b.agent_instance),
        }
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

    let content = match std::fs::read_to_string(&final_path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SubagentFinalOutput {
                exists: false,
                json: None,
                parse_error: None,
            })
        }
        Err(err) => return Err(err.to_string()),
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

    let content = match std::fs::read_to_string(&events_path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.to_string()),
    };

    let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let start = lines.len().saturating_sub(limit);
    Ok(lines[start..].to_vec())
}
