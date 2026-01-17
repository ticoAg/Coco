use agentmesh_core::task::AgentInstance;
use agentmesh_core::task::AgentInstanceState;
use agentmesh_core::task::ClusterStatus;
use agentmesh_core::task::CreateTaskRequest;
use agentmesh_core::task::CreateTaskResponse;
use agentmesh_core::task::Gate;
use agentmesh_core::task::GateState;
use agentmesh_core::task::GateType;
use agentmesh_core::task::TaskEvent;
use agentmesh_core::task::TaskFile;
use agentmesh_core::task::TaskState;
use agentmesh_core::task_store::TaskStore;
use agentmesh_core::task_store::TaskStoreError;
use chrono::Utc;
use serde_json::json;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;
use std::thread;
use std::time::Duration;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct Orchestrator {
    store: TaskStore,
}

#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    #[error("{0}")]
    Store(#[from] TaskStoreError),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid agent instance: {agent_instance}")]
    InvalidAgentInstance { agent_instance: String },
    #[error("subagent already exists: {agent_instance}")]
    SubagentAlreadyExists { agent_instance: String },
    #[error("subagent not found: {agent_instance}")]
    SubagentNotFound { agent_instance: String },
    #[error("concurrency limit exceeded: active={active}, limit={limit}")]
    ConcurrencyLimit { active: u32, limit: u32 },
    #[error("wait-any timeout after {timeout_seconds}s")]
    WaitAnyTimeout { timeout_seconds: u32 },
    #[error("codex binary not found on PATH")]
    CodexNotFound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubagentStatus {
    Running,
    Completed,
    Failed,
    Blocked,
    Cancelled,
}

impl SubagentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SubagentStatus::Running => "running",
            SubagentStatus::Completed => "completed",
            SubagentStatus::Failed => "failed",
            SubagentStatus::Blocked => "blocked",
            SubagentStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentInfo {
    pub agent_instance: String,
    pub agent: String,
    pub status: SubagentStatus,
}

#[derive(Debug, Clone)]
pub struct SubagentSpawnRequest {
    pub task_id: String,
    pub agent_instance: String,
    pub agent: String,
    pub prompt: String,
    pub cwd: PathBuf,
    pub codex_bin: PathBuf,
    pub output_schema_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentSpawnResponse {
    pub agent_instance: String,
    pub pid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentWaitAnyResult {
    pub agent_instance: String,
    pub status: SubagentStatus,
}

const TASK_AGENTS_DIR_NAME: &str = "agents";
const TASK_SHARED_DIR_NAME: &str = "shared";
const TASK_SHARED_REPORTS_DIR_NAME: &str = "reports";
const TASK_SHARED_EVIDENCE_DIR_NAME: &str = "evidence";
const TASK_SHARED_EVIDENCE_INDEX_FILE_NAME: &str = "index.json";
const RUNTIME_DIR_NAME: &str = "runtime";
const ARTIFACTS_DIR_NAME: &str = "artifacts";
const CODEX_HOME_DIR_NAME: &str = "codex_home";

const RUNTIME_EVENTS_FILE_NAME: &str = "events.jsonl";
const RUNTIME_STDERR_FILE_NAME: &str = "stderr.log";
const RUNTIME_PID_FILE_NAME: &str = "pid";
const FINAL_OUTPUT_FILE_NAME: &str = "final.json";
const SESSION_FILE_NAME: &str = "session.json";
const JOINED_SUMMARY_MD_FILE_NAME: &str = "joined-summary.md";
const JOINED_SUMMARY_JSON_FILE_NAME: &str = "joined-summary.json";

const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const CANCEL_GRACE_PERIOD: Duration = Duration::from_secs(3);
const CANCEL_TERMINATE_PERIOD: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinTaskResponse {
    pub joined_summary_md: PathBuf,
    pub joined_summary_json: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct EvidenceEntry {
    id: String,
    kind: String,
    title: String,
    summary: String,
    created_at: String,
    sources: Vec<EvidenceSource>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    artifact_refs: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum EvidenceSource {
    FileAnchor {
        path: String,
        start_line: u32,
        end_line: u32,
    },
    CommandExecution {
        command: String,
        cwd: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stdout_ref: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stderr_ref: Option<String>,
    },
    RuntimeEventRange {
        events_ref: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        start_line: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        end_line: Option<u32>,
    },
}

impl Orchestrator {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            store: TaskStore::new(workspace_root),
        }
    }

    pub fn workspace_root(&self) -> &Path {
        self.store.workspace_root()
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

    pub fn subagent_spawn(
        &self,
        req: SubagentSpawnRequest,
    ) -> Result<SubagentSpawnResponse, OrchestratorError> {
        validate_agent_instance(&req.agent_instance)?;
        validate_agent_instance(&req.agent)?;

        let reconcile = self.reconcile_subagents(&req.task_id)?;
        if reconcile
            .subagents
            .iter()
            .any(|a| a.agent_instance == req.agent_instance)
        {
            return Err(OrchestratorError::SubagentAlreadyExists {
                agent_instance: req.agent_instance,
            });
        }

        let limit = reconcile.task.config.max_concurrent_agents;
        let active = reconcile
            .subagents
            .iter()
            .filter(|a| a.status == SubagentStatus::Running)
            .count() as u32;
        if active >= limit {
            return Err(OrchestratorError::ConcurrencyLimit { active, limit });
        }

        let task_dir = self.store.task_dir(&req.task_id);
        let agent_dir = agent_dir(&task_dir, &req.agent_instance);
        if agent_dir.exists() {
            return Err(OrchestratorError::SubagentAlreadyExists {
                agent_instance: req.agent_instance,
            });
        }

        let runtime_dir = agent_dir.join(RUNTIME_DIR_NAME);
        let artifacts_dir = agent_dir.join(ARTIFACTS_DIR_NAME);
        let codex_home_dir = agent_dir.join(CODEX_HOME_DIR_NAME);
        fs::create_dir_all(&runtime_dir)?;
        fs::create_dir_all(&artifacts_dir)?;
        fs::create_dir_all(&codex_home_dir)?;

        let events_path = runtime_dir.join(RUNTIME_EVENTS_FILE_NAME);
        let stderr_path = runtime_dir.join(RUNTIME_STDERR_FILE_NAME);
        let pid_path = runtime_dir.join(RUNTIME_PID_FILE_NAME);
        let session_path = agent_dir.join(SESSION_FILE_NAME);
        let final_output_path = artifacts_dir.join(FINAL_OUTPUT_FILE_NAME);

        let _ = fs::remove_file(&final_output_path);

        write_session_file(&session_path, &req.cwd, &codex_home_dir)?;

        let events_file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&events_path)?;
        let stderr_file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&stderr_path)?;

        let mut cmd = Command::new(&req.codex_bin);
        cmd.arg("exec")
            .arg("--json")
            .arg("-C")
            .arg(&req.cwd)
            .arg("--output-schema")
            .arg(&req.output_schema_path)
            .arg("--output-last-message")
            .arg(&final_output_path)
            .arg(&req.prompt)
            .env("CODEX_HOME", &codex_home_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(events_file))
            .stderr(Stdio::from(stderr_file))
            .current_dir(&req.cwd);

        let child = match cmd.spawn() {
            Ok(child) => child,
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                return Err(OrchestratorError::CodexNotFound)
            }
            Err(err) => return Err(OrchestratorError::Io(err)),
        };

        let pid = child.id();
        drop(child);

        fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&pid_path)?
            .write_all(format!("{pid}\n").as_bytes())?;

        let mut task = reconcile.task;
        task.roster.push(AgentInstance {
            instance: req.agent_instance.clone(),
            agent: req.agent,
            state: AgentInstanceState::Active,
            assigned_milestone: None,
            skills: Vec::new(),
        });
        task.updated_at = Utc::now();
        self.store.write_task(&task)?;

        self.append_agent_event(
            &task.id,
            &req.agent_instance,
            "agent.started",
            json!({
                "cwd": req.cwd.to_string_lossy(),
                "adapter": "codex-exec",
            }),
        )?;

        Ok(SubagentSpawnResponse {
            agent_instance: req.agent_instance,
            pid,
        })
    }

    pub fn subagent_list(&self, task_id: &str) -> Result<Vec<SubagentInfo>, OrchestratorError> {
        Ok(self.reconcile_subagents(task_id)?.subagents)
    }

    pub fn subagent_wait_any(
        &self,
        task_id: &str,
        timeout_seconds: Option<u32>,
    ) -> Result<SubagentWaitAnyResult, OrchestratorError> {
        let task = self.store.read_task(task_id)?;
        let timeout_seconds = timeout_seconds.unwrap_or(task.config.timeout_seconds);

        let deadline = Instant::now() + Duration::from_secs(timeout_seconds as u64);
        loop {
            let reconcile = self.reconcile_subagents(task_id)?;
            if let Some(found) = reconcile
                .subagents
                .iter()
                .find(|a| a.status != SubagentStatus::Running)
            {
                return Ok(SubagentWaitAnyResult {
                    agent_instance: found.agent_instance.clone(),
                    status: found.status,
                });
            }

            if Instant::now() >= deadline {
                return Err(OrchestratorError::WaitAnyTimeout { timeout_seconds });
            }

            thread::sleep(DEFAULT_POLL_INTERVAL);
        }
    }

    pub fn subagent_cancel(
        &self,
        task_id: &str,
        agent_instance: &str,
    ) -> Result<(), OrchestratorError> {
        validate_agent_instance(agent_instance)?;

        let mut task = self.store.read_task(task_id)?;
        let Some(agent) = task
            .roster
            .iter_mut()
            .find(|a| a.instance == agent_instance)
        else {
            return Err(OrchestratorError::SubagentNotFound {
                agent_instance: agent_instance.to_string(),
            });
        };

        let task_dir = self.store.task_dir(task_id);
        let agent_dir = agent_dir(&task_dir, agent_instance);
        let runtime_dir = agent_dir.join(RUNTIME_DIR_NAME);
        let pid_path = runtime_dir.join(RUNTIME_PID_FILE_NAME);
        let pid = read_pid(&pid_path)?;

        if let Some(pid) = pid {
            cancel_pid(pid)?;

            // If we can confirm exit, remove pid to avoid stale "running" counts.
            if !pid_is_alive(pid)? {
                let _ = fs::remove_file(&pid_path);
            }
        }

        let mut event_index = self.load_agent_event_index(task_id)?;
        self.ensure_agent_event(
            &mut event_index,
            task_id,
            agent_instance,
            "agent.cancelled",
            json!({}),
        )?;

        if agent.state != AgentInstanceState::Failed {
            agent.state = AgentInstanceState::Failed;
            task.updated_at = Utc::now();
            self.store.write_task(&task)?;
        }

        Ok(())
    }

    pub fn task_join(&self, task_id: &str) -> Result<JoinTaskResponse, OrchestratorError> {
        let task = self.reconcile_subagents(task_id)?.task;
        let task_dir = self.store.task_dir(task_id);

        let reports_dir = task_dir
            .join(TASK_SHARED_DIR_NAME)
            .join(TASK_SHARED_REPORTS_DIR_NAME);
        fs::create_dir_all(&reports_dir)?;

        let evidence_dir = task_dir
            .join(TASK_SHARED_DIR_NAME)
            .join(TASK_SHARED_EVIDENCE_DIR_NAME);
        fs::create_dir_all(&evidence_dir)?;
        let evidence_index_path = evidence_dir.join(TASK_SHARED_EVIDENCE_INDEX_FILE_NAME);

        let mut workers = Vec::new();
        for agent in &task.roster {
            let final_path = agent_dir(&task_dir, &agent.instance)
                .join(ARTIFACTS_DIR_NAME)
                .join(FINAL_OUTPUT_FILE_NAME);
            let final_output = read_worker_final_output(&final_path)?;
            workers.push(JoinedWorkerSummary {
                agent_instance: agent.instance.clone(),
                agent: agent.agent.clone(),
                status: final_output.status,
                summary: final_output.summary,
                questions: final_output.questions,
                next_actions: final_output.next_actions,
            });
        }

        let generated_at = Utc::now();

        // Evidence Index: keep the evidence entries small and reference the raw recordings/artifacts.
        // For now, join produces a minimal per-worker evidence entry so reports can cite it.
        let evidence_entries = workers
            .iter()
            .map(|w| {
                let evidence_id = evidence_id_for_agent_instance(&w.agent_instance);
                EvidenceEntry {
                    id: evidence_id.clone(),
                    kind: "runtime-event-range".to_string(),
                    title: format!("Worker {} runtime", w.agent_instance),
                    summary: format!(
                        "[{}] {}",
                        w.status,
                        w.summary.trim().to_string()
                    )
                    .trim()
                    .to_string(),
                    created_at: generated_at.to_rfc3339(),
                    sources: vec![EvidenceSource::RuntimeEventRange {
                        events_ref: format!(
                            "./agents/{}/runtime/{}",
                            w.agent_instance, RUNTIME_EVENTS_FILE_NAME
                        ),
                        start_line: None,
                        end_line: None,
                    }],
                    artifact_refs: vec![
                        format!(
                            "./agents/{}/artifacts/{}",
                            w.agent_instance, FINAL_OUTPUT_FILE_NAME
                        ),
                        format!(
                            "./agents/{}/runtime/{}",
                            w.agent_instance, RUNTIME_EVENTS_FILE_NAME
                        ),
                    ],
                }
            })
            .collect::<Vec<_>>();
        fs::write(
            &evidence_index_path,
            serde_json::to_string_pretty(&evidence_entries)?,
        )?;

        let markdown = render_joined_summary_markdown(&task, generated_at, &workers);
        let md_path = reports_dir.join(JOINED_SUMMARY_MD_FILE_NAME);
        fs::write(&md_path, markdown)?;

        let json_value = json!({
            "taskId": task.id,
            "generatedAt": generated_at.to_rfc3339(),
            "workers": workers.iter().map(|w| {
                json!({
                    "agentInstance": w.agent_instance,
                    "agent": w.agent,
                    "status": w.status,
                    "summary": w.summary,
                    "questions": w.questions,
                    "nextActions": w.next_actions,
                })
            }).collect::<Vec<_>>(),
        });
        let json_path = reports_dir.join(JOINED_SUMMARY_JSON_FILE_NAME);
        fs::write(&json_path, serde_json::to_string_pretty(&json_value)?)?;

        Ok(JoinTaskResponse {
            joined_summary_md: md_path,
            joined_summary_json: json_path,
        })
    }

    fn reconcile_subagents(
        &self,
        task_id: &str,
    ) -> Result<ReconcileSubagentsOutput, OrchestratorError> {
        let mut task = self.store.read_task(task_id)?;
        let mut agent_event_index = self.load_agent_event_index(task_id)?;
        let mut gate_event_index = self.load_gate_event_index(task_id)?;

        let task_dir = self.store.task_dir(task_id);
        let cancelled = agent_event_index
            .by_agent
            .iter()
            .filter_map(|(agent, events)| {
                if events.contains("agent.cancelled") {
                    Some(agent.clone())
                } else {
                    None
                }
            })
            .collect::<HashSet<_>>();

        let mut roster_changed = false;
        let mut gates_changed = false;
        let mut task_state_changed = false;
        let mut subagents = Vec::new();
        let mut any_blocked = false;

        for idx in 0..task.roster.len() {
            let agent_instance = task.roster[idx].instance.clone();
            let agent_name = task.roster[idx].agent.clone();
            let agent_state = task.roster[idx].state;

            let agent_dir = agent_dir(&task_dir, &agent_instance);
            let runtime_dir = agent_dir.join(RUNTIME_DIR_NAME);
            let artifacts_dir = agent_dir.join(ARTIFACTS_DIR_NAME);

            let events_path = runtime_dir.join(RUNTIME_EVENTS_FILE_NAME);
            let session_path = agent_dir.join(SESSION_FILE_NAME);
            let pid_path = runtime_dir.join(RUNTIME_PID_FILE_NAME);
            let final_output_path = artifacts_dir.join(FINAL_OUTPUT_FILE_NAME);

            if events_path.exists() && session_path.exists() {
                maybe_update_session_thread_id(&events_path, &session_path)?;
            }

            let status = if cancelled.contains(&agent_instance) {
                SubagentStatus::Cancelled
            } else if let Some(final_status) = read_final_status(&final_output_path)? {
                match final_status.as_str() {
                    "success" => SubagentStatus::Completed,
                    "blocked" => SubagentStatus::Blocked,
                    "failed" => SubagentStatus::Failed,
                    _ => SubagentStatus::Failed,
                }
            } else if let Some(pid) = read_pid(&pid_path)? {
                if pid_is_alive(pid)? {
                    SubagentStatus::Running
                } else {
                    SubagentStatus::Failed
                }
            } else {
                match agent_state {
                    AgentInstanceState::Active => SubagentStatus::Failed,
                    AgentInstanceState::Awaiting => SubagentStatus::Blocked,
                    AgentInstanceState::Completed => SubagentStatus::Completed,
                    AgentInstanceState::Failed => SubagentStatus::Failed,
                    AgentInstanceState::Pending | AgentInstanceState::Dormant => {
                        SubagentStatus::Running
                    }
                }
            };

            match status {
                SubagentStatus::Running => {
                    if task.roster[idx].state != AgentInstanceState::Active {
                        task.roster[idx].state = AgentInstanceState::Active;
                        roster_changed = true;
                    }
                }
                SubagentStatus::Blocked => {
                    any_blocked = true;
                    if task.roster[idx].state != AgentInstanceState::Awaiting {
                        task.roster[idx].state = AgentInstanceState::Awaiting;
                        roster_changed = true;
                    }
                    self.ensure_agent_event(
                        &mut agent_event_index,
                        task_id,
                        &agent_instance,
                        "agent.blocked",
                        json!({}),
                    )?;

                    gates_changed |= self.ensure_blocked_gate(
                        &mut task,
                        &mut gate_event_index,
                        &agent_instance,
                        &final_output_path,
                    )?;
                }
                SubagentStatus::Completed => {
                    if task.roster[idx].state != AgentInstanceState::Completed {
                        task.roster[idx].state = AgentInstanceState::Completed;
                        roster_changed = true;
                    }
                    self.ensure_agent_event(
                        &mut agent_event_index,
                        task_id,
                        &agent_instance,
                        "agent.completed",
                        json!({}),
                    )?;
                }
                SubagentStatus::Failed => {
                    if task.roster[idx].state != AgentInstanceState::Failed {
                        task.roster[idx].state = AgentInstanceState::Failed;
                        roster_changed = true;
                    }
                    self.ensure_agent_event(
                        &mut agent_event_index,
                        task_id,
                        &agent_instance,
                        "agent.failed",
                        json!({}),
                    )?;
                }
                SubagentStatus::Cancelled => {
                    if task.roster[idx].state != AgentInstanceState::Failed {
                        task.roster[idx].state = AgentInstanceState::Failed;
                        roster_changed = true;
                    }
                    self.ensure_agent_event(
                        &mut agent_event_index,
                        task_id,
                        &agent_instance,
                        "agent.cancelled",
                        json!({}),
                    )?;
                }
            }

            subagents.push(SubagentInfo {
                agent_instance,
                agent: agent_name,
                status,
            });
        }

        if any_blocked && task.state != TaskState::InputRequired {
            match task.state {
                TaskState::Created | TaskState::Working => {
                    task.state = TaskState::InputRequired;
                    task_state_changed = true;
                }
                TaskState::InputRequired
                | TaskState::Completed
                | TaskState::Failed
                | TaskState::Canceled => {}
            }
        }

        if roster_changed || gates_changed || task_state_changed {
            task.updated_at = Utc::now();
            self.store.write_task(&task)?;
        }

        Ok(ReconcileSubagentsOutput { task, subagents })
    }

    fn append_agent_event(
        &self,
        task_id: &str,
        agent_instance: &str,
        event_type: &str,
        payload: serde_json::Value,
    ) -> Result<(), OrchestratorError> {
        let payload = ensure_payload_agent_instance(payload, agent_instance);
        let event = TaskEvent {
            ts: Utc::now(),
            event_type: event_type.to_string(),
            task_id: task_id.to_string(),
            agent_instance: Some(agent_instance.to_string()),
            turn_id: None,
            payload,
            by: Some("orchestrator".to_string()),
            path: None,
        };
        self.store.append_task_event(task_id, &event)?;
        Ok(())
    }

    fn ensure_agent_event(
        &self,
        index: &mut AgentEventIndex,
        task_id: &str,
        agent_instance: &str,
        event_type: &str,
        payload: serde_json::Value,
    ) -> Result<(), OrchestratorError> {
        let entry = index
            .by_agent
            .entry(agent_instance.to_string())
            .or_default();
        if entry.contains(event_type) {
            return Ok(());
        }

        self.append_agent_event(task_id, agent_instance, event_type, payload)?;
        entry.insert(event_type.to_string());
        Ok(())
    }

    fn load_agent_event_index(&self, task_id: &str) -> Result<AgentEventIndex, OrchestratorError> {
        let events = self
            .store
            .read_task_events(task_id, Some("agent."), usize::MAX, 0)?;

        let mut by_agent: HashMap<String, HashSet<String>> = HashMap::new();
        for event in events {
            let Some(agent_instance) = event.agent_instance else {
                continue;
            };
            by_agent
                .entry(agent_instance)
                .or_default()
                .insert(event.event_type);
        }

        Ok(AgentEventIndex { by_agent })
    }

    fn ensure_blocked_gate(
        &self,
        task: &mut TaskFile,
        gate_event_index: &mut GateEventIndex,
        agent_instance: &str,
        final_output_path: &Path,
    ) -> Result<bool, OrchestratorError> {
        let gate_id = format!("gate-{agent_instance}");
        let final_output = read_worker_final_output(final_output_path)?;
        let reason = blocked_gate_reason(agent_instance, &final_output);

        let now = Utc::now();
        let instructions_ref = Some("./shared/human-notes.md".to_string());

        let mut changed = false;
        if let Some(gate) = task.gates.iter_mut().find(|g| g.id == gate_id) {
            if gate.gate_type != GateType::HumanApproval {
                gate.gate_type = GateType::HumanApproval;
                changed = true;
            }
            if gate.state != GateState::Blocked {
                gate.state = GateState::Blocked;
                changed = true;
            }
            if gate.reason != reason {
                gate.reason = reason.clone();
                changed = true;
            }
            if gate.instructions_ref != instructions_ref {
                gate.instructions_ref = instructions_ref.clone();
                changed = true;
            }
            if gate.blocked_at.is_none() {
                gate.blocked_at = Some(now);
                changed = true;
            }
            if gate.resolved_at.is_some() {
                gate.resolved_at = None;
                changed = true;
            }
            if gate.resolved_by.is_some() {
                gate.resolved_by = None;
                changed = true;
            }
        } else {
            task.gates.push(Gate {
                id: gate_id.clone(),
                gate_type: GateType::HumanApproval,
                state: GateState::Blocked,
                reason: reason.clone(),
                instructions_ref,
                blocked_at: Some(now),
                resolved_at: None,
                resolved_by: None,
            });
            changed = true;
        }

        self.ensure_gate_event(
            gate_event_index,
            &task.id,
            &gate_id,
            Some(agent_instance),
            "gate.blocked",
            json!({
                "reason": reason,
            }),
        )?;

        Ok(changed)
    }

    fn append_gate_event(
        &self,
        task_id: &str,
        gate_id: &str,
        agent_instance: Option<&str>,
        event_type: &str,
        payload: serde_json::Value,
    ) -> Result<(), OrchestratorError> {
        let mut payload = ensure_payload_gate_id(payload, gate_id);
        if let Some(agent_instance) = agent_instance {
            payload = ensure_payload_agent_instance(payload, agent_instance);
        }

        let event = TaskEvent {
            ts: Utc::now(),
            event_type: event_type.to_string(),
            task_id: task_id.to_string(),
            agent_instance: agent_instance.map(|v| v.to_string()),
            turn_id: None,
            payload,
            by: Some("orchestrator".to_string()),
            path: None,
        };
        self.store.append_task_event(task_id, &event)?;
        Ok(())
    }

    fn ensure_gate_event(
        &self,
        index: &mut GateEventIndex,
        task_id: &str,
        gate_id: &str,
        agent_instance: Option<&str>,
        event_type: &str,
        payload: serde_json::Value,
    ) -> Result<(), OrchestratorError> {
        let entry = index.by_gate.entry(gate_id.to_string()).or_default();
        if entry.contains(event_type) {
            return Ok(());
        }

        self.append_gate_event(task_id, gate_id, agent_instance, event_type, payload)?;
        entry.insert(event_type.to_string());
        Ok(())
    }

    fn load_gate_event_index(&self, task_id: &str) -> Result<GateEventIndex, OrchestratorError> {
        let events = self
            .store
            .read_task_events(task_id, Some("gate."), usize::MAX, 0)?;

        let mut by_gate: HashMap<String, HashSet<String>> = HashMap::new();
        for event in events {
            let Some(gate_id) = event
                .payload
                .get("gateId")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string())
            else {
                continue;
            };
            by_gate.entry(gate_id).or_default().insert(event.event_type);
        }

        Ok(GateEventIndex { by_gate })
    }
}

#[derive(Debug)]
struct ReconcileSubagentsOutput {
    task: TaskFile,
    subagents: Vec<SubagentInfo>,
}

#[derive(Debug)]
struct AgentEventIndex {
    by_agent: HashMap<String, HashSet<String>>,
}

#[derive(Debug)]
struct GateEventIndex {
    by_gate: HashMap<String, HashSet<String>>,
}

fn agent_dir(task_dir: &Path, agent_instance: &str) -> PathBuf {
    task_dir.join(TASK_AGENTS_DIR_NAME).join(agent_instance)
}

#[derive(Debug, Clone)]
struct JoinedWorkerSummary {
    agent_instance: String,
    agent: String,
    status: String,
    summary: String,
    questions: Vec<String>,
    next_actions: Vec<String>,
}

#[derive(Debug, Clone)]
struct WorkerFinalOutputSnapshot {
    status: String,
    summary: String,
    questions: Vec<String>,
    next_actions: Vec<String>,
}

fn read_worker_final_output(path: &Path) -> Result<WorkerFinalOutputSnapshot, OrchestratorError> {
    if !path.exists() {
        return Ok(WorkerFinalOutputSnapshot {
            status: "missing".to_string(),
            summary: "final output is missing".to_string(),
            questions: Vec::new(),
            next_actions: Vec::new(),
        });
    }

    let content = fs::read_to_string(path)?;
    let value: serde_json::Value = serde_json::from_str(&content)?;

    let status = value
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("failed")
        .to_string();
    let summary = value
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let questions = value
        .get("questions")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let next_actions = value
        .get("nextActions")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(WorkerFinalOutputSnapshot {
        status,
        summary,
        questions,
        next_actions,
    })
}

fn blocked_gate_reason(agent_instance: &str, output: &WorkerFinalOutputSnapshot) -> String {
    if let Some(first) = output.questions.first() {
        let more = output.questions.len().saturating_sub(1);
        if more == 0 {
            return first.clone();
        }
        return format!("{first} (+{more} more)");
    }

    if !output.summary.trim().is_empty() {
        return output.summary.trim().to_string();
    }

    format!("blocked by {agent_instance}")
}

fn render_joined_summary_markdown(
    task: &TaskFile,
    generated_at: chrono::DateTime<Utc>,
    workers: &[JoinedWorkerSummary],
) -> String {
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!(
        "title: \"Joined Summary: {}\"\n",
        escape_yaml_string(&task.title)
    ));
    out.push_str("purpose: \"汇总多个 subagent 的最终输出与阻塞点\"\n");
    out.push_str("tags: [\"joined-summary\", \"subagents\"]\n");
    out.push_str(&format!("task_id: \"{}\"\n", escape_yaml_string(&task.id)));
    out.push_str(&format!(
        "generated_at: \"{}\"\n",
        generated_at.to_rfc3339()
    ));
    out.push_str("---\n\n");

    out.push_str(&format!("# Joined Summary: {}\n\n", task.title));
    out.push_str(&format!("- task: `{}`\n", task.id));
    out.push_str(&format!(
        "- generatedAt: `{}`\n\n",
        generated_at.to_rfc3339()
    ));

    out.push_str("## Workers\n\n");
    for w in workers {
        out.push_str(&format!("### {} ({})\n\n", w.agent_instance, w.agent));
        out.push_str(&format!("- status: `{}`\n", w.status));
        out.push_str(&format!(
            "- evidence: evidence:{}\n",
            evidence_id_for_agent_instance(&w.agent_instance)
        ));
        if !w.summary.trim().is_empty() {
            out.push_str(&format!("- summary: {}\n", w.summary.trim()));
        }

        if !w.questions.is_empty() {
            out.push_str("- questions:\n");
            for q in &w.questions {
                out.push_str(&format!("  - {}\n", q.trim()));
            }
        }

        if !w.next_actions.is_empty() {
            out.push_str("- nextActions:\n");
            for a in &w.next_actions {
                out.push_str(&format!("  - {}\n", a.trim()));
            }
        }

        out.push('\n');
    }

    out
}

fn evidence_id_for_agent_instance(agent_instance: &str) -> String {
    let normalized = agent_instance.replace('_', "-");
    format!("worker-{normalized}")
}

fn escape_yaml_string(value: &str) -> String {
    value.replace('"', "\\\"")
}

fn validate_agent_instance(value: &str) -> Result<(), OrchestratorError> {
    let is_ok = !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if is_ok {
        Ok(())
    } else {
        Err(OrchestratorError::InvalidAgentInstance {
            agent_instance: value.to_string(),
        })
    }
}

fn write_session_file(path: &Path, cwd: &Path, codex_home: &Path) -> Result<(), OrchestratorError> {
    let json = json!({
      "adapter": "codex-exec",
      "vendorSession": {
        "tool": "codex",
        "threadId": serde_json::Value::Null,
        "cwd": cwd.to_string_lossy(),
        "codexHome": path_to_portable_string(path.parent().unwrap_or(Path::new(".")), codex_home),
      },
      "recording": {
        "events": "./runtime/events.jsonl",
        "stderr": "./runtime/stderr.log",
      }
    });

    fs::write(path, serde_json::to_string_pretty(&json)?)?;
    Ok(())
}

fn ensure_payload_agent_instance(
    payload: serde_json::Value,
    agent_instance: &str,
) -> serde_json::Value {
    match payload {
        serde_json::Value::Object(mut obj) => {
            obj.entry("agentInstance".to_string())
                .or_insert_with(|| serde_json::Value::String(agent_instance.to_string()));
            serde_json::Value::Object(obj)
        }
        other => json!({
            "agentInstance": agent_instance,
            "value": other,
        }),
    }
}

fn ensure_payload_gate_id(payload: serde_json::Value, gate_id: &str) -> serde_json::Value {
    match payload {
        serde_json::Value::Object(mut obj) => {
            obj.entry("gateId".to_string())
                .or_insert_with(|| serde_json::Value::String(gate_id.to_string()));
            serde_json::Value::Object(obj)
        }
        other => json!({
            "gateId": gate_id,
            "value": other,
        }),
    }
}

fn path_to_portable_string(base_dir: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(base_dir) {
        if rel.as_os_str().is_empty() {
            return ".".to_string();
        }
        return format!("./{}", rel.to_string_lossy());
    }
    path.to_string_lossy().to_string()
}

fn maybe_update_session_thread_id(
    events_path: &Path,
    session_path: &Path,
) -> Result<(), OrchestratorError> {
    let thread_id = extract_thread_id_from_events(events_path)?;
    let Some(thread_id) = thread_id else {
        return Ok(());
    };

    let content = fs::read_to_string(session_path)?;
    let mut value: serde_json::Value = serde_json::from_str(&content)?;

    let has_thread_id = value
        .get("vendorSession")
        .and_then(|v| v.get("threadId"))
        .and_then(|v| v.as_str())
        .is_some();

    if has_thread_id {
        return Ok(());
    }

    if let Some(vendor) = value.get_mut("vendorSession") {
        if let Some(obj) = vendor.as_object_mut() {
            obj.insert("threadId".to_string(), serde_json::Value::String(thread_id));
        }
    }

    fs::write(session_path, serde_json::to_string_pretty(&value)?)?;
    Ok(())
}

fn extract_thread_id_from_events(path: &Path) -> Result<Option<String>, OrchestratorError> {
    let content = fs::read_to_string(path)?;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let event_type = value.get("type").and_then(|v| v.as_str());
        if event_type != Some("thread.started") {
            continue;
        }
        if let Some(id) = value.get("thread_id").and_then(|v| v.as_str()) {
            return Ok(Some(id.to_string()));
        }
        if let Some(id) = value.get("threadId").and_then(|v| v.as_str()) {
            return Ok(Some(id.to_string()));
        }
    }
    Ok(None)
}

fn read_final_status(path: &Path) -> Result<Option<String>, OrchestratorError> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    let value: serde_json::Value = serde_json::from_str(&content)?;
    Ok(value
        .get("status")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string()))
}

fn read_pid(path: &Path) -> Result<Option<i32>, OrchestratorError> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let pid: i32 = trimmed
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid pid"))?;
    Ok(Some(pid))
}

fn cancel_pid(pid: i32) -> Result<(), OrchestratorError> {
    if !pid_is_alive(pid)? {
        return Ok(());
    }

    send_signal(pid, libc::SIGINT)?;
    let start = Instant::now();
    while start.elapsed() < CANCEL_GRACE_PERIOD {
        if !pid_is_alive(pid)? {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }

    if pid_is_alive(pid)? {
        send_signal(pid, libc::SIGTERM)?;
    }

    let start = Instant::now();
    while start.elapsed() < CANCEL_TERMINATE_PERIOD {
        if !pid_is_alive(pid)? {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }

    #[cfg(unix)]
    {
        if pid_is_alive(pid)? {
            send_signal(pid, libc::SIGKILL)?;
        }
    }

    #[cfg(not(unix))]
    {
        let _ = Command::new("taskkill")
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F")
            .status();
    }

    Ok(())
}

fn pid_is_alive(pid: i32) -> Result<bool, OrchestratorError> {
    #[cfg(unix)]
    {
        let mut status: libc::c_int = 0;
        let rc = unsafe { libc::waitpid(pid, &mut status as *mut _, libc::WNOHANG) };
        if rc == 0 {
            return Ok(true);
        }
        if rc == pid {
            return Ok(false);
        }
        if rc == -1 {
            let err = io::Error::last_os_error();
            match err.raw_os_error() {
                Some(code) if code == libc::ECHILD => {}
                Some(code) if code == libc::ESRCH => return Ok(false),
                _ => return Err(OrchestratorError::Io(err)),
            }
        }

        let rc = unsafe { libc::kill(pid, 0) };
        if rc == 0 {
            return Ok(true);
        }
        let err = io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::ESRCH) {
            return Ok(false);
        }
        Err(OrchestratorError::Io(err))
    }

    #[cfg(not(unix))]
    {
        // Best-effort fallback: assume alive if we have a pid.
        let _ = pid;
        Ok(true)
    }
}

fn send_signal(pid: i32, signal: i32) -> Result<(), OrchestratorError> {
    #[cfg(unix)]
    {
        let rc = unsafe { libc::kill(pid, signal) };
        if rc == 0 {
            return Ok(());
        }
        let err = io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }
        Err(OrchestratorError::Io(err))
    }

    #[cfg(not(unix))]
    {
        let _ = (pid, signal);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agentmesh_core::task::CreateTaskRequest;
    use agentmesh_core::task::TaskConfig;
    use agentmesh_core::task::TaskTopology;
    use std::time::SystemTime;
    use std::time::UNIX_EPOCH;

    fn new_temp_workspace_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("agentmesh-test-{nanos}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn spawn_sleep_process() -> std::process::Child {
        if cfg!(windows) {
            Command::new("cmd")
                .args(["/C", "ping -n 60 127.0.0.1 > NUL"])
                .spawn()
                .unwrap()
        } else {
            Command::new("sleep").arg("60").spawn().unwrap()
        }
    }

    #[test]
    fn enforces_max_concurrent_agents() {
        let root = new_temp_workspace_root();
        let _guard = TempDirGuard(root.clone());

        let orchestrator = Orchestrator::new(root.clone());
        let resp = orchestrator
            .create_task(CreateTaskRequest {
                title: "test".to_string(),
                description: "".to_string(),
                topology: TaskTopology::Swarm,
                milestones: Vec::new(),
                roster: Vec::new(),
                config: Some(TaskConfig {
                    max_concurrent_agents: 2,
                    timeout_seconds: 1,
                    auto_approve: false,
                }),
            })
            .unwrap();

        let task_id = resp.id;
        let mut task = orchestrator.get_task(&task_id).unwrap();

        let mut child1 = spawn_sleep_process();
        let mut child2 = spawn_sleep_process();

        for (instance, child) in [("a1", &child1), ("a2", &child2)] {
            task.roster.push(AgentInstance {
                instance: instance.to_string(),
                agent: "worker".to_string(),
                state: AgentInstanceState::Active,
                assigned_milestone: None,
                skills: Vec::new(),
            });

            let agent_dir = orchestrator
                .store
                .task_dir(&task_id)
                .join("agents")
                .join(instance);
            let runtime_dir = agent_dir.join("runtime");
            fs::create_dir_all(&runtime_dir).unwrap();
            fs::write(runtime_dir.join("pid"), format!("{}\n", child.id())).unwrap();
        }

        orchestrator.store.write_task(&task).unwrap();

        let req = SubagentSpawnRequest {
            task_id: task_id.clone(),
            agent_instance: "a3".to_string(),
            agent: "worker".to_string(),
            prompt: "noop".to_string(),
            cwd: std::env::current_dir().unwrap(),
            codex_bin: PathBuf::from("codex"),
            output_schema_path: root.join("schemas").join("worker-output.schema.json"),
        };

        let err = orchestrator.subagent_spawn(req).unwrap_err();
        assert!(matches!(err, OrchestratorError::ConcurrencyLimit { .. }));

        let _ = child1.kill();
        let _ = child2.kill();
        let _ = child1.wait();
        let _ = child2.wait();
    }

    #[test]
    fn cancel_appends_cancelled_event() {
        let root = new_temp_workspace_root();
        let _guard = TempDirGuard(root.clone());

        let orchestrator = Orchestrator::new(root.clone());
        let resp = orchestrator
            .create_task(CreateTaskRequest {
                title: "test".to_string(),
                description: "".to_string(),
                topology: TaskTopology::Swarm,
                milestones: Vec::new(),
                roster: Vec::new(),
                config: None,
            })
            .unwrap();

        let task_id = resp.id;
        let mut task = orchestrator.get_task(&task_id).unwrap();

        let mut child = spawn_sleep_process();
        task.roster.push(AgentInstance {
            instance: "a1".to_string(),
            agent: "worker".to_string(),
            state: AgentInstanceState::Active,
            assigned_milestone: None,
            skills: Vec::new(),
        });
        orchestrator.store.write_task(&task).unwrap();

        let agent_dir = orchestrator
            .store
            .task_dir(&task_id)
            .join("agents")
            .join("a1");
        let runtime_dir = agent_dir.join("runtime");
        fs::create_dir_all(&runtime_dir).unwrap();
        fs::write(runtime_dir.join("pid"), format!("{}\n", child.id())).unwrap();

        orchestrator.subagent_cancel(&task_id, "a1").unwrap();

        let events = orchestrator
            .store
            .read_task_events(&task_id, Some("agent."), usize::MAX, 0)
            .unwrap();
        assert!(events.iter().any(|e| {
            e.event_type == "agent.cancelled" && e.agent_instance.as_deref() == Some("a1")
        }));

        // Best-effort cleanup: the cancel path may reap the child process.
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn join_includes_all_worker_fields() {
        let root = new_temp_workspace_root();
        let _guard = TempDirGuard(root.clone());

        let orchestrator = Orchestrator::new(root.clone());
        let resp = orchestrator
            .create_task(CreateTaskRequest {
                title: "join test".to_string(),
                description: "".to_string(),
                topology: TaskTopology::Swarm,
                milestones: Vec::new(),
                roster: Vec::new(),
                config: None,
            })
            .unwrap();

        let task_id = resp.id;
        let mut task = orchestrator.get_task(&task_id).unwrap();
        task.roster.push(AgentInstance {
            instance: "w1".to_string(),
            agent: "worker".to_string(),
            state: AgentInstanceState::Completed,
            assigned_milestone: None,
            skills: Vec::new(),
        });
        task.roster.push(AgentInstance {
            instance: "w2".to_string(),
            agent: "worker".to_string(),
            state: AgentInstanceState::Completed,
            assigned_milestone: None,
            skills: Vec::new(),
        });
        orchestrator.store.write_task(&task).unwrap();

        let task_dir = orchestrator.store.task_dir(&task_id);
        write_worker_final_json(
            &task_dir,
            "w1",
            json!({
                "status": "success",
                "summary": "summary-one",
                "questions": ["question-one"],
                "nextActions": ["action-one"],
            }),
        );
        write_worker_final_json(
            &task_dir,
            "w2",
            json!({
                "status": "blocked",
                "summary": "summary-two",
                "questions": ["question-two"],
                "nextActions": ["action-two"],
            }),
        );

        let resp = orchestrator.task_join(&task_id).unwrap();

        let md = fs::read_to_string(resp.joined_summary_md).unwrap();
        assert!(md.contains("summary-one"));
        assert!(md.contains("question-one"));
        assert!(md.contains("action-one"));
        assert!(md.contains("summary-two"));
        assert!(md.contains("question-two"));
        assert!(md.contains("action-two"));
        assert!(md.contains("evidence:worker-w1"));
        assert!(md.contains("evidence:worker-w2"));

        let json_content = fs::read_to_string(resp.joined_summary_json).unwrap();
        assert!(json_content.contains("summary-one"));
        assert!(json_content.contains("question-one"));
        assert!(json_content.contains("action-one"));
        assert!(json_content.contains("summary-two"));
        assert!(json_content.contains("question-two"));
        assert!(json_content.contains("action-two"));

        let evidence_index_path = task_dir
            .join("shared")
            .join("evidence")
            .join("index.json");
        let evidence_index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(evidence_index_path).unwrap()).unwrap();
        let evidence_entries = evidence_index.as_array().unwrap();
        assert_eq!(evidence_entries.len(), 2);

        let w1 = evidence_entries
            .iter()
            .find(|v| v.get("id").and_then(|s| s.as_str()) == Some("worker-w1"))
            .unwrap();
        assert_eq!(w1.get("kind").and_then(|s| s.as_str()), Some("runtime-event-range"));
        let w1_sources = w1.get("sources").and_then(|v| v.as_array()).unwrap();
        assert_eq!(
            w1_sources[0].get("type").and_then(|s| s.as_str()),
            Some("runtimeEventRange")
        );
        assert_eq!(
            w1_sources[0].get("eventsRef").and_then(|s| s.as_str()),
            Some("./agents/w1/runtime/events.jsonl")
        );
    }

    fn write_worker_final_json(task_dir: &Path, agent_instance: &str, value: serde_json::Value) {
        let artifacts_dir = task_dir
            .join("agents")
            .join(agent_instance)
            .join("artifacts");
        fs::create_dir_all(&artifacts_dir).unwrap();
        fs::write(
            artifacts_dir.join("final.json"),
            serde_json::to_string_pretty(&value).unwrap(),
        )
        .unwrap();
    }

    struct TempDirGuard(PathBuf);

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
