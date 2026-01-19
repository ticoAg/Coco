use crate::task::CreateTaskRequest;
use crate::task::CreateTaskResponse;
use crate::task::TaskEvent;
use crate::task::TaskFile;
use chrono::Utc;
use std::fs;
use std::io;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskStoreError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("task not found: {task_id}")]
    TaskNotFound { task_id: String },
    #[error("invalid task id: {task_id}")]
    InvalidTaskId { task_id: String },
}

#[derive(Debug, Clone)]
pub struct TaskStore {
    workspace_root: PathBuf,
}

impl TaskStore {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }

    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    pub fn tasks_dir(&self) -> PathBuf {
        self.workspace_root.join(".coco").join("tasks")
    }

    fn ensure_tasks_dir(&self) -> Result<(), TaskStoreError> {
        fs::create_dir_all(self.tasks_dir())?;
        Ok(())
    }

    pub fn task_dir(&self, task_id: &str) -> PathBuf {
        self.tasks_dir().join(task_id)
    }

    pub fn list_tasks(&self) -> Result<Vec<TaskFile>, TaskStoreError> {
        self.ensure_tasks_dir()?;
        let mut tasks = Vec::new();

        for entry in fs::read_dir(self.tasks_dir())? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(task_id) = path.file_name().and_then(|v| v.to_str()) else {
                continue;
            };
            if task_id.starts_with('.') || task_id == "placeholder" {
                continue;
            }

            let task_yaml_path = path.join("task.yaml");
            if !task_yaml_path.exists() {
                continue;
            }
            let task = self.read_task(task_id)?;
            tasks.push(task);
        }

        tasks.sort_by_key(|t| t.updated_at);
        tasks.reverse();

        Ok(tasks)
    }

    pub fn read_task(&self, task_id: &str) -> Result<TaskFile, TaskStoreError> {
        let task_yaml_path = self.task_dir(task_id).join("task.yaml");
        if !task_yaml_path.exists() {
            return Err(TaskStoreError::TaskNotFound {
                task_id: task_id.to_string(),
            });
        }
        let content = fs::read_to_string(task_yaml_path)?;
        let task: TaskFile = serde_yaml::from_str(&content)?;
        Ok(task)
    }

    pub fn write_task(&self, task: &TaskFile) -> Result<(), TaskStoreError> {
        self.ensure_tasks_dir()?;
        let task_dir = self.task_dir(&task.id);
        fs::create_dir_all(&task_dir)?;
        let task_yaml_path = task_dir.join("task.yaml");
        let yaml = serde_yaml::to_string(task)?;
        fs::write(task_yaml_path, yaml)?;
        Ok(())
    }

    pub fn read_task_events(
        &self,
        task_id: &str,
        event_type_prefix: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<TaskEvent>, TaskStoreError> {
        let events_path = self.task_dir(task_id).join("events.jsonl");
        if !events_path.exists() {
            return Ok(Vec::new());
        }
        let content = fs::read_to_string(events_path)?;
        let mut events = Vec::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let event: TaskEvent = serde_json::from_str(line)?;
            if let Some(prefix) = event_type_prefix {
                if !event.event_type.starts_with(prefix) {
                    continue;
                }
            }
            events.push(event);
        }

        let sliced = events.into_iter().skip(offset).take(limit).collect();
        Ok(sliced)
    }

    pub fn append_task_event(
        &self,
        task_id: &str,
        event: &TaskEvent,
    ) -> Result<(), TaskStoreError> {
        let task_dir = self.task_dir(task_id);
        fs::create_dir_all(&task_dir)?;
        let events_path = task_dir.join("events.jsonl");
        let mut line = serde_json::to_string(event)?;
        line.push('\n');
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(events_path)?
            .write_all(line.as_bytes())?;
        Ok(())
    }

    pub fn create_task(
        &self,
        req: CreateTaskRequest,
    ) -> Result<CreateTaskResponse, TaskStoreError> {
        self.ensure_tasks_dir()?;

        let task_id = generate_task_id();
        validate_task_id(&task_id)?;

        let now = Utc::now();
        let task = TaskFile {
            id: task_id.clone(),
            title: req.title,
            description: req.description,
            topology: req.topology,
            state: crate::task::TaskState::Created,
            created_at: now,
            updated_at: now,
            milestones: req.milestones,
            roster: req.roster,
            gates: Vec::new(),
            config: req.config.unwrap_or_default(),
        };

        let task_dir = self.task_dir(&task_id);
        let shared_dir = task_dir.join("shared");
        fs::create_dir_all(&shared_dir)?;
        fs::create_dir_all(task_dir.join("agents"))?;
        self.write_task(&task)?;

        let human_notes_path = shared_dir.join("human-notes.md");
        if !human_notes_path.exists() {
            fs::write(
                human_notes_path,
                "# Human Notes\n\n- 在这里记录人工补充、约束与纠错。\n",
            )?;
        }

        let context_manifest_path = shared_dir.join("context-manifest.yaml");
        if !context_manifest_path.exists() {
            fs::write(context_manifest_path, "attachments: []\n")?;
        }

        // Evidence Index (artifacts-first): keep an append-only-friendly "index of pointers"
        // so reports can cite evidence without dumping raw logs into the main context.
        let evidence_dir = shared_dir.join("evidence");
        fs::create_dir_all(&evidence_dir)?;
        let evidence_index_path = evidence_dir.join("index.json");
        if !evidence_index_path.exists() {
            fs::write(evidence_index_path, "[]\n")?;
        }

        let readme_path = self.task_dir(&task_id).join("README.md");
        if !readme_path.exists() {
            let topology = match task.topology {
                crate::task::TaskTopology::Swarm => "swarm",
                crate::task::TaskTopology::Squad => "squad",
            };
            let state = match task.state {
                crate::task::TaskState::Created => "created",
                crate::task::TaskState::Working => "working",
                crate::task::TaskState::InputRequired => "input-required",
                crate::task::TaskState::Completed => "completed",
                crate::task::TaskState::Failed => "failed",
                crate::task::TaskState::Canceled => "canceled",
            };
            fs::write(
                readme_path,
                format!(
                    "# {}\n\n- id: `{}`\n- topology: `{}`\n- state: `{}`\n",
                    task.title, task.id, topology, state
                ),
            )?;
        }

        let created_event = TaskEvent {
            ts: now,
            event_type: "task.created".to_string(),
            task_id: task_id.clone(),
            agent_instance: None,
            turn_id: None,
            payload: serde_json::Value::Object(serde_json::Map::new()),
            by: Some("user".to_string()),
            path: None,
        };
        self.append_task_event(&task_id, &created_event)?;

        Ok(CreateTaskResponse {
            id: task_id,
            message: "Task created successfully".to_string(),
        })
    }
}

fn validate_task_id(task_id: &str) -> Result<(), TaskStoreError> {
    let is_ok = !task_id.is_empty()
        && task_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if is_ok {
        Ok(())
    } else {
        Err(TaskStoreError::InvalidTaskId {
            task_id: task_id.to_string(),
        })
    }
}

fn generate_task_id() -> String {
    format!("task-{}", uuid::Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::CreateTaskRequest;
    use crate::task::TaskTopology;

    #[test]
    fn create_task_scaffolds_human_notes_context_manifest_and_evidence_index() {
        let workspace_root = std::env::temp_dir().join(format!(
            "coco-core-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let store = TaskStore::new(workspace_root.clone());
        let resp = store
            .create_task(CreateTaskRequest {
                title: "Test".to_string(),
                description: String::new(),
                topology: TaskTopology::Swarm,
                milestones: Vec::new(),
                roster: Vec::new(),
                config: None,
            })
            .unwrap();

        let task_dir = store.task_dir(&resp.id);
        assert!(task_dir.join("shared").join("human-notes.md").exists());
        assert!(task_dir
            .join("shared")
            .join("context-manifest.yaml")
            .exists());
        let evidence_index_path = task_dir.join("shared").join("evidence").join("index.json");
        assert!(evidence_index_path.exists());
        let evidence_index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&evidence_index_path).unwrap()).unwrap();
        assert!(evidence_index.is_array());

        fs::remove_dir_all(workspace_root).unwrap();
    }
}
