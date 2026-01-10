use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            cluster_status,
            list_tasks,
            get_task,
            get_task_events,
            create_task,
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
