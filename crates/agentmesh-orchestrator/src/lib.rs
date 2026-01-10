use agentmesh_core::task::AgentInstance;
use agentmesh_core::task::AgentInstanceState;
use agentmesh_core::task::ClusterStatus;
use agentmesh_core::task::CreateTaskRequest;
use agentmesh_core::task::CreateTaskResponse;
use agentmesh_core::task::TaskEvent;
use agentmesh_core::task::TaskFile;
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
const RUNTIME_DIR_NAME: &str = "runtime";
const ARTIFACTS_DIR_NAME: &str = "artifacts";
const CODEX_HOME_DIR_NAME: &str = "codex_home";

const RUNTIME_EVENTS_FILE_NAME: &str = "events.jsonl";
const RUNTIME_STDERR_FILE_NAME: &str = "stderr.log";
const RUNTIME_PID_FILE_NAME: &str = "pid";
const FINAL_OUTPUT_FILE_NAME: &str = "final.json";
const SESSION_FILE_NAME: &str = "session.json";

const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const CANCEL_GRACE_PERIOD: Duration = Duration::from_secs(3);
const CANCEL_TERMINATE_PERIOD: Duration = Duration::from_secs(2);

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

    fn reconcile_subagents(&self, task_id: &str) -> Result<ReconcileSubagentsOutput, OrchestratorError> {
        let mut task = self.store.read_task(task_id)?;
        let mut event_index = self.load_agent_event_index(task_id)?;

        let task_dir = self.store.task_dir(task_id);
        let cancelled = event_index
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
        let mut subagents = Vec::new();

        for agent in &mut task.roster {
            let agent_dir = agent_dir(&task_dir, &agent.instance);
            let runtime_dir = agent_dir.join(RUNTIME_DIR_NAME);
            let artifacts_dir = agent_dir.join(ARTIFACTS_DIR_NAME);

            let events_path = runtime_dir.join(RUNTIME_EVENTS_FILE_NAME);
            let session_path = agent_dir.join(SESSION_FILE_NAME);
            let pid_path = runtime_dir.join(RUNTIME_PID_FILE_NAME);
            let final_output_path = artifacts_dir.join(FINAL_OUTPUT_FILE_NAME);

            if events_path.exists() && session_path.exists() {
                maybe_update_session_thread_id(&events_path, &session_path)?;
            }

            let status = if cancelled.contains(&agent.instance) {
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
                match agent.state {
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
                    if agent.state != AgentInstanceState::Active {
                        agent.state = AgentInstanceState::Active;
                        roster_changed = true;
                    }
                }
                SubagentStatus::Blocked => {
                    if agent.state != AgentInstanceState::Awaiting {
                        agent.state = AgentInstanceState::Awaiting;
                        roster_changed = true;
                    }
                    self.ensure_agent_event(
                        &mut event_index,
                        task_id,
                        &agent.instance,
                        "agent.blocked",
                        json!({}),
                    )?;
                }
                SubagentStatus::Completed => {
                    if agent.state != AgentInstanceState::Completed {
                        agent.state = AgentInstanceState::Completed;
                        roster_changed = true;
                    }
                    self.ensure_agent_event(
                        &mut event_index,
                        task_id,
                        &agent.instance,
                        "agent.completed",
                        json!({}),
                    )?;
                }
                SubagentStatus::Failed => {
                    if agent.state != AgentInstanceState::Failed {
                        agent.state = AgentInstanceState::Failed;
                        roster_changed = true;
                    }
                    self.ensure_agent_event(
                        &mut event_index,
                        task_id,
                        &agent.instance,
                        "agent.failed",
                        json!({}),
                    )?;
                }
                SubagentStatus::Cancelled => {
                    if agent.state != AgentInstanceState::Failed {
                        agent.state = AgentInstanceState::Failed;
                        roster_changed = true;
                    }
                    self.ensure_agent_event(
                        &mut event_index,
                        task_id,
                        &agent.instance,
                        "agent.cancelled",
                        json!({}),
                    )?;
                }
            }

            subagents.push(SubagentInfo {
                agent_instance: agent.instance.clone(),
                agent: agent.agent.clone(),
                status,
            });
        }

        if roster_changed {
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

fn agent_dir(task_dir: &Path, agent_instance: &str) -> PathBuf {
    task_dir
        .join(TASK_AGENTS_DIR_NAME)
        .join(agent_instance)
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
    let pid: i32 = trimmed.parse().map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid pid"))?;
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
        return Err(OrchestratorError::Io(err));
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
            Command::new("sh").arg("-c").arg("sleep 60").spawn().unwrap()
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

            let agent_dir = orchestrator.store.task_dir(&task_id).join("agents").join(instance);
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

        let agent_dir = orchestrator.store.task_dir(&task_id).join("agents").join("a1");
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

    struct TempDirGuard(PathBuf);

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
