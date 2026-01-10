use agentmesh_core::task::ClusterStatus;
use agentmesh_core::task::CreateTaskRequest;
use agentmesh_core::task::CreateTaskResponse;
use agentmesh_core::task::TaskEvent;
use agentmesh_core::task::TaskFile;
use agentmesh_core::task_store::TaskStore;
use agentmesh_core::task_store::TaskStoreError;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Orchestrator {
    store: TaskStore,
}

impl Orchestrator {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            store: TaskStore::new(workspace_root),
        }
    }

    pub fn list_tasks(&self) -> Result<Vec<TaskFile>, TaskStoreError> {
        self.store.list_tasks()
    }

    pub fn get_task(&self, task_id: &str) -> Result<TaskFile, TaskStoreError> {
        self.store.read_task(task_id)
    }

    pub fn get_task_events(
        &self,
        task_id: &str,
        event_type_prefix: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<TaskEvent>, TaskStoreError> {
        self.store
            .read_task_events(task_id, event_type_prefix, limit, offset)
    }

    pub fn create_task(
        &self,
        req: CreateTaskRequest,
    ) -> Result<CreateTaskResponse, TaskStoreError> {
        self.store.create_task(req)
    }

    pub fn cluster_status(&self) -> ClusterStatus {
        ClusterStatus {
            orchestrator: "online".to_string(),
            codex_adapter: "disconnected".to_string(),
            active_agents: 0,
            max_agents: 8,
        }
    }
}
