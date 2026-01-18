use crate::JoinTaskResponse;
use crate::Orchestrator;
use crate::OrchestratorError;
use crate::SubagentSpawnRequest;
use crate::SubagentStatus;
use agentmesh_core::task::AgentInstance;
use agentmesh_core::task::AgentInstanceState;
use agentmesh_core::task::TaskEvent;
use agentmesh_core::task::TaskState;
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

const STATE_BOARD_FILE_NAME: &str = "state-board.md";
const HUMAN_NOTES_FILE_NAME: &str = "human-notes.md";
const EVIDENCE_INDEX_REL: &str = "./shared/evidence/index.json";
const JOINED_SUMMARY_MD_REL: &str = "./shared/reports/joined-summary.md";
const JOINED_SUMMARY_JSON_REL: &str = "./shared/reports/joined-summary.json";

const STATEBOARD_BEGIN: &str = "<!-- AGENTMESH:STATEBOARD:START -->";
const STATEBOARD_END: &str = "<!-- AGENTMESH:STATEBOARD:END -->";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControllerState {
    Dispatching,
    Monitoring,
    Joining,
    Blocked,
    Done,
}

impl ControllerState {
    fn as_str(&self) -> &'static str {
        match self {
            ControllerState::Dispatching => "dispatching",
            ControllerState::Monitoring => "monitoring",
            ControllerState::Joining => "joining",
            ControllerState::Blocked => "blocked",
            ControllerState::Done => "done",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControllerOutcome {
    Done,
    Blocked,
}

#[derive(Debug, Clone)]
pub struct ControllerOptions {
    /// Default `codex` binary for adapter execution.
    pub codex_bin: PathBuf,
    /// Default JSON schema for worker outputs (used by codex-exec).
    pub output_schema_path: PathBuf,
    /// Default working directory for workers when `cwd` is not provided in actions.
    pub default_cwd: PathBuf,
    /// Poll interval used while monitoring.
    pub poll_interval: Duration,
    /// Timeout for wait-any calls (seconds). When None, uses task.yaml config.
    pub timeout_seconds: Option<u32>,
}

impl ControllerOptions {
    pub fn new(workspace_root: &Path) -> Self {
        Self {
            codex_bin: PathBuf::from("codex"),
            output_schema_path: workspace_root
                .join("schemas")
                .join("worker-output.schema.json"),
            default_cwd: workspace_root.to_path_buf(),
            poll_interval: Duration::from_millis(250),
            timeout_seconds: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ControllerRunResult {
    pub outcome: ControllerOutcome,
    pub joined_summary: Option<JoinTaskResponse>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorActions {
    pub session_goal: String,
    pub tasks: Vec<OrchestratorSubtask>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorSubtask {
    pub task_id: String,
    #[serde(default)]
    pub agent_instance: Option<String>,
    pub title: String,
    pub agent: String,
    pub adapter: String,
    pub prompt: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub forked_from_thread_id: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub output_schema_path: Option<String>,
}

impl OrchestratorSubtask {
    pub fn resolved_agent_instance(&self) -> String {
        self.agent_instance
            .clone()
            .unwrap_or_else(|| self.task_id.clone())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControllerStateChangedPayload {
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_goal: Option<String>,
}

impl Orchestrator {
    /// Execute a full controller loop:
    /// - parse actions
    /// - dispatch subtasks
    /// - monitor until done/blocked
    /// - join and write shared reports
    /// - maintain `shared/state-board.md`
    pub fn controller_run_actions(
        &self,
        task_id: &str,
        actions: OrchestratorActions,
        opts: ControllerOptions,
    ) -> Result<ControllerRunResult, OrchestratorError> {
        // Ensure task exists.
        let _ = self.get_task(task_id)?;

        self.set_task_state_working(task_id)?;

        self.write_controller_state(
            task_id,
            ControllerState::Dispatching,
            Some(&actions.session_goal),
        )?;
        self.write_state_board(task_id, &actions, ControllerState::Dispatching, None)?;

        self.dispatch_actions(task_id, &actions, &opts)?;

        self.write_controller_state(task_id, ControllerState::Monitoring, None)?;
        self.write_state_board(task_id, &actions, ControllerState::Monitoring, None)?;

        let outcome = self.monitor_until_terminal(task_id, &actions, &opts)?;
        if outcome == ControllerOutcome::Blocked {
            self.write_controller_state(task_id, ControllerState::Blocked, None)?;
            self.write_state_board(task_id, &actions, ControllerState::Blocked, None)?;
            return Ok(ControllerRunResult {
                outcome,
                joined_summary: None,
            });
        }

        self.write_controller_state(task_id, ControllerState::Joining, None)?;
        self.write_state_board(task_id, &actions, ControllerState::Joining, None)?;

        let joined = self.task_join(task_id)?;

        self.write_controller_state(task_id, ControllerState::Done, None)?;
        self.write_state_board(task_id, &actions, ControllerState::Done, Some(&joined))?;

        Ok(ControllerRunResult {
            outcome: ControllerOutcome::Done,
            joined_summary: Some(joined),
        })
    }

    pub fn controller_run_actions_from_path(
        &self,
        task_id: &str,
        actions_path: &Path,
        opts: ControllerOptions,
    ) -> Result<ControllerRunResult, OrchestratorError> {
        let content = fs::read_to_string(actions_path)?;
        let actions: OrchestratorActions = serde_json::from_str(&content)?;
        self.controller_run_actions(task_id, actions, opts)
    }

    fn dispatch_actions(
        &self,
        task_id: &str,
        actions: &OrchestratorActions,
        opts: &ControllerOptions,
    ) -> Result<(), OrchestratorError> {
        let mut remaining = actions.tasks.clone();

        // Skip tasks that already exist in the roster (supports "resume" by re-running the loop).
        let existing = self
            .subagent_list(task_id)?
            .into_iter()
            .map(|a| a.agent_instance)
            .collect::<std::collections::HashSet<_>>();
        remaining.retain(|t| !existing.contains(&t.resolved_agent_instance()));

        // Dispatch with backpressure: if we hit the concurrency limit, wait for one worker to exit
        // and then continue.
        let mut idx = 0usize;
        while idx < remaining.len() {
            let subtask = remaining[idx].clone();
            match subtask.adapter.as_str() {
                "codex-exec" => match self.dispatch_codex_exec(task_id, &subtask, opts) {
                    Ok(()) => idx += 1,
                    Err(OrchestratorError::ConcurrencyLimit { .. }) => {
                        // Wait for any running worker to finish, then retry this subtask.
                        let _ = self.subagent_wait_any(task_id, opts.timeout_seconds)?;
                    }
                    Err(err) => return Err(err),
                },
                "codex-app-server" => {
                    // MVP: run app-server subtask synchronously (one turn) so we can still join.
                    self.dispatch_codex_app_server(task_id, &subtask, opts)?;
                    idx += 1;
                }
                other => {
                    return Err(OrchestratorError::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        format!("unsupported adapter: {other}"),
                    )))
                }
            }
        }

        Ok(())
    }

    fn dispatch_codex_exec(
        &self,
        task_id: &str,
        subtask: &OrchestratorSubtask,
        opts: &ControllerOptions,
    ) -> Result<(), OrchestratorError> {
        let agent_instance = subtask.resolved_agent_instance();

        let cwd = resolve_optional_path(&subtask.cwd, &opts.default_cwd);
        let output_schema_path = subtask
            .output_schema_path
            .as_deref()
            .map(|p| resolve_optional_path(&Some(p.to_string()), &opts.default_cwd))
            .unwrap_or_else(|| opts.output_schema_path.clone());

        let _ = self.subagent_spawn(SubagentSpawnRequest {
            task_id: task_id.to_string(),
            agent_instance,
            agent: subtask.agent.clone(),
            prompt: subtask.prompt.clone(),
            cwd,
            codex_bin: opts.codex_bin.clone(),
            output_schema_path,
        })?;

        Ok(())
    }

    fn dispatch_codex_app_server(
        &self,
        task_id: &str,
        subtask: &OrchestratorSubtask,
        opts: &ControllerOptions,
    ) -> Result<(), OrchestratorError> {
        // Ensure the agent instance exists in roster + has a workspace, even though we don't
        // spawn a long-running process.
        let agent_instance = subtask.resolved_agent_instance();
        let cwd = resolve_optional_path(&subtask.cwd, &opts.default_cwd);
        self.ensure_agent_instance(task_id, &agent_instance, &subtask.agent, &cwd)?;

        let task_dir = self.store.task_dir(task_id);
        let agent_dir = task_dir.join("agents").join(&agent_instance);
        fs::create_dir_all(agent_dir.join("runtime"))?;
        fs::create_dir_all(agent_dir.join("artifacts"))?;

        // Run a single app-server turn and persist worker-style final output.
        // This is a pragmatic bridge: codex app-server does not currently support a CLI-level
        // `--output-schema` like `codex exec`, so we ask the agent to emit JSON and capture it
        // from streamed item events.
        let mode = subtask.mode.as_deref().unwrap_or("spawn");
        let forked_from = subtask.forked_from_thread_id.clone();

        let final_path = agent_dir.join("artifacts").join("final.json");

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(OrchestratorError::Io)?;
        rt.block_on(async {
            run_app_server_one_turn(
                &agent_dir,
                &cwd,
                &opts.codex_bin,
                mode,
                forked_from.as_deref(),
                &subtask.prompt,
                &final_path,
            )
            .await
        })?;

        Ok(())
    }

    fn monitor_until_terminal(
        &self,
        task_id: &str,
        actions: &OrchestratorActions,
        opts: &ControllerOptions,
    ) -> Result<ControllerOutcome, OrchestratorError> {
        let expected_instances = actions
            .tasks
            .iter()
            .map(|t| t.resolved_agent_instance())
            .collect::<std::collections::HashSet<_>>();

        loop {
            let subagents = self.subagent_list(task_id)?;
            let mut all_terminal = true;
            let mut any_blocked = false;

            for s in &subagents {
                if !expected_instances.contains(&s.agent_instance) {
                    continue;
                }
                match s.status {
                    SubagentStatus::Running => all_terminal = false,
                    SubagentStatus::Blocked => any_blocked = true,
                    SubagentStatus::Completed
                    | SubagentStatus::Failed
                    | SubagentStatus::Cancelled => {}
                }
            }

            if any_blocked {
                return Ok(ControllerOutcome::Blocked);
            }
            if all_terminal {
                return Ok(ControllerOutcome::Done);
            }

            // Wait for any worker to become non-running. This also provides a timeout boundary.
            let _ = self.subagent_wait_any(task_id, opts.timeout_seconds)?;
            std::thread::sleep(opts.poll_interval);
        }
    }

    fn set_task_state_working(&self, task_id: &str) -> Result<(), OrchestratorError> {
        let mut task = self.store.read_task(task_id)?;
        if task.state == TaskState::Created {
            task.state = TaskState::Working;
            task.updated_at = Utc::now();
            self.store.write_task(&task)?;
        }
        Ok(())
    }

    fn ensure_agent_instance(
        &self,
        task_id: &str,
        agent_instance: &str,
        agent_name: &str,
        cwd: &Path,
    ) -> Result<(), OrchestratorError> {
        let mut task = self.store.read_task(task_id)?;
        if task.roster.iter().any(|a| a.instance == agent_instance) {
            return Ok(());
        }

        task.roster.push(AgentInstance {
            instance: agent_instance.to_string(),
            agent: agent_name.to_string(),
            state: AgentInstanceState::Active,
            assigned_milestone: None,
            skills: Vec::new(),
        });
        task.updated_at = Utc::now();
        self.store.write_task(&task)?;

        // Mirror `subagent_spawn`'s event semantics for consistency.
        let event = TaskEvent {
            ts: Utc::now(),
            event_type: "agent.started".to_string(),
            task_id: task_id.to_string(),
            agent_instance: Some(agent_instance.to_string()),
            turn_id: None,
            payload: json!({
                "cwd": cwd.to_string_lossy(),
                "adapter": "codex-app-server",
            }),
            by: Some("controller".to_string()),
            path: None,
        };
        self.store.append_task_event(task_id, &event)?;

        Ok(())
    }

    fn write_controller_state(
        &self,
        task_id: &str,
        state: ControllerState,
        session_goal: Option<&str>,
    ) -> Result<(), OrchestratorError> {
        let payload = ControllerStateChangedPayload {
            state: state.as_str().to_string(),
            session_goal: session_goal.map(|v| v.to_string()),
        };

        let event = TaskEvent {
            ts: Utc::now(),
            event_type: "controller.state.changed".to_string(),
            task_id: task_id.to_string(),
            agent_instance: None,
            turn_id: None,
            payload: serde_json::to_value(payload)?,
            by: Some("controller".to_string()),
            path: None,
        };
        self.store.append_task_event(task_id, &event)?;
        Ok(())
    }

    fn write_state_board(
        &self,
        task_id: &str,
        actions: &OrchestratorActions,
        controller_state: ControllerState,
        joined: Option<&JoinTaskResponse>,
    ) -> Result<(), OrchestratorError> {
        let task = self.store.read_task(task_id)?;
        let subagents = self.subagent_list(task_id).unwrap_or_default();
        let status_by_agent_instance: HashMap<String, String> = subagents
            .into_iter()
            .map(|s| (s.agent_instance, s.status.as_str().to_string()))
            .collect();

        let shared_dir = self.store.task_dir(task_id).join("shared");
        fs::create_dir_all(&shared_dir)?;

        let state_board_path = shared_dir.join(STATE_BOARD_FILE_NAME);
        let now = Utc::now().to_rfc3339();

        let mut managed = String::new();
        managed.push_str("# StateBoard\n\n");
        managed.push_str(&format!("- task: `{}`\n", task.id));
        managed.push_str(&format!("- title: {}\n", task.title));
        managed.push_str(&format!(
            "- controllerState: `{}`\n",
            controller_state.as_str()
        ));
        managed.push_str(&format!("- updatedAt: `{}`\n", now));
        managed.push_str(&format!(
            "- sessionGoal: {}\n\n",
            actions.session_goal.trim()
        ));

        managed.push_str("## Subtasks\n\n");
        for t in &actions.tasks {
            let instance = t.resolved_agent_instance();
            let status = status_by_agent_instance
                .get(&instance)
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            managed.push_str(&format!(
                "- `{}` agent=`{}` adapter=`{}` status=`{}` title=\"{}\"\n",
                instance,
                t.agent,
                t.adapter,
                status,
                escape_markdown_inline(&t.title)
            ));
        }
        managed.push('\n');

        managed.push_str("## Key Artifacts\n\n");
        managed.push_str(&format!("- joinedSummaryMd: `{}`\n", JOINED_SUMMARY_MD_REL));
        managed.push_str(&format!(
            "- joinedSummaryJson: `{}`\n",
            JOINED_SUMMARY_JSON_REL
        ));
        managed.push_str(&format!("- evidenceIndex: `{}`\n", EVIDENCE_INDEX_REL));
        managed.push_str(&format!(
            "- humanNotes: `./shared/{}`\n",
            HUMAN_NOTES_FILE_NAME
        ));
        if let Some(joined) = joined {
            managed.push_str(&format!(
                "- joinedSummaryMdPath: `{}`\n",
                joined.joined_summary_md.to_string_lossy()
            ));
            managed.push_str(&format!(
                "- joinedSummaryJsonPath: `{}`\n",
                joined.joined_summary_json.to_string_lossy()
            ));
        }
        managed.push('\n');

        let next = upsert_managed_block(&fs::read_to_string(&state_board_path).ok(), &managed);
        fs::write(state_board_path, next)?;
        Ok(())
    }
}

async fn run_app_server_one_turn(
    agent_dir: &Path,
    cwd: &Path,
    codex_bin: &Path,
    mode: &str,
    forked_from_thread_id: Option<&str>,
    prompt: &str,
    final_output_path: &Path,
) -> Result<(), OrchestratorError> {
    use agentmesh_codex::CodexAppServerClient;
    use agentmesh_codex::CodexAppServerSpawnRequest;

    let mut req = CodexAppServerSpawnRequest::new(agent_dir.to_path_buf(), cwd.to_path_buf());
    req.codex_bin = codex_bin.to_path_buf();

    let client = CodexAppServerClient::spawn(req).await?;
    let mut events = client.subscribe_events();

    let thread_id = match mode {
        "fork" => {
            let parent = forked_from_thread_id.ok_or_else(|| {
                OrchestratorError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "mode=fork requires forkedFromThreadId",
                ))
            })?;
            client.thread_fork(parent, None).await?
        }
        _ => client.thread_start(None).await?,
    };

    let wrapped_prompt = format!(
        "{}\n\n{}\n",
        "# Output Contract\nReturn ONLY valid JSON matching schemas/worker-output.schema.json.\nRequired keys: status, summary. Optional: questions, nextActions, errors.\n",
        prompt
    );

    let params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": wrapped_prompt }],
    });

    let _ = client.turn_start(params).await?;

    let mut last_agent_message_text: Option<String> = None;
    let mut blocked_reason: Option<String> = None;
    let mut turn_done = false;

    while !turn_done {
        let evt = match events.recv().await {
            Ok(evt) => evt,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => break,
        };

        match evt.kind.as_str() {
            "request" => {
                // Approval requests surface here; treat as blocked and stop.
                let method = evt
                    .message
                    .get("method")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                blocked_reason = Some(format!("approval request: {method}"));
                break;
            }
            "notification" => {
                let method = evt
                    .message
                    .get("method")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let params = evt.message.get("params").cloned().unwrap_or(Value::Null);

                if method == "item/completed" {
                    if let Some(item) = params.get("item") {
                        if item.get("type").and_then(|v| v.as_str()) == Some("agentMessage") {
                            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                                last_agent_message_text = Some(text.to_string());
                            }
                        }
                    }
                }

                if method == "turn/completed" {
                    turn_done = true;
                }
                if method == "error" {
                    blocked_reason = Some("app-server error".to_string());
                    break;
                }
            }
            _ => {}
        }
    }

    let final_output = if let Some(reason) = blocked_reason {
        json!({
            "status": "blocked",
            "summary": reason,
            "questions": ["Please approve/resolve the pending request in GUI or via controller gate."],
            "nextActions": ["Review the pending approval request and resume the controller loop."],
        })
    } else if let Some(text) = last_agent_message_text {
        match extract_json_from_text(&text)
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
        {
            Some(value) => value,
            None => json!({
                "status": "failed",
                "summary": "agentMessage is not valid JSON",
                "errors": ["Expected JSON worker output; got plain text."],
            }),
        }
    } else {
        json!({
            "status": "failed",
            "summary": "missing agentMessage output",
            "errors": ["No agentMessage item captured from app-server events."],
        })
    };

    tokio::fs::write(
        final_output_path,
        serde_json::to_string_pretty(&final_output)?,
    )
    .await
    .map_err(OrchestratorError::Io)?;

    client.shutdown().await;
    Ok(())
}

fn resolve_optional_path(value: &Option<String>, default_base: &Path) -> PathBuf {
    match value.as_deref() {
        None => default_base.to_path_buf(),
        Some(v) if v.trim().is_empty() => default_base.to_path_buf(),
        Some(v) => {
            let p = PathBuf::from(v);
            if p.is_absolute() {
                p
            } else {
                default_base.join(p)
            }
        }
    }
}

fn upsert_managed_block(existing: &Option<String>, managed_content: &str) -> String {
    let block = format!(
        "{begin}\n{content}\n{end}\n",
        begin = STATEBOARD_BEGIN,
        content = managed_content.trim_end(),
        end = STATEBOARD_END
    );

    let Some(existing) = existing else {
        return format!(
            "{block}\n## Notes\n\n- You can write human notes below. Controller will preserve this section.\n",
            block = block
        );
    };

    if let (Some(start), Some(end)) = (
        existing.find(STATEBOARD_BEGIN),
        existing.find(STATEBOARD_END),
    ) {
        if end > start {
            let after_end = end + STATEBOARD_END.len();
            let mut out = String::new();
            out.push_str(&existing[..start]);
            out.push_str(&block);
            out.push_str(&existing[after_end..]);
            return out;
        }
    }

    // If markers are missing or invalid, prepend a new managed block and keep existing content.
    format!("{block}\n{rest}", block = block, rest = existing.trim())
}

fn escape_markdown_inline(value: &str) -> String {
    value.replace('`', "\\`")
}

fn extract_json_from_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }
    // Best-effort: extract the first {...} block.
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(trimmed[start..=end].to_string())
}
