use chrono::DateTime;
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;

fn now() -> DateTime<Utc> {
    Utc::now()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TaskTopology {
    Swarm,
    Squad,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TaskState {
    Created,
    Working,
    #[serde(alias = "gate.blocked")]
    InputRequired,
    Completed,
    Failed,
    #[serde(alias = "cancelled")]
    Canceled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MilestoneState {
    Pending,
    #[serde(alias = "in_progress")]
    Working,
    Done,
    Blocked,
}

impl Default for MilestoneState {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub state: MilestoneState,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstanceState {
    #[serde(alias = "created")]
    Pending,
    Active,
    Awaiting,
    Dormant,
    Completed,
    Failed,
}

impl Default for AgentInstanceState {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstance {
    pub instance: String,
    pub agent: String,
    #[serde(default)]
    pub state: AgentInstanceState,
    pub assigned_milestone: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GateType {
    HumanApproval,
    AutoCheck,
    MilestoneGate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GateState {
    Open,
    Blocked,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Gate {
    pub id: String,
    #[serde(rename = "type")]
    pub gate_type: GateType,
    pub state: GateState,
    #[serde(default)]
    pub reason: String,
    pub instructions_ref: Option<String>,
    pub blocked_at: Option<DateTime<Utc>>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskConfig {
    pub max_concurrent_agents: u32,
    pub timeout_seconds: u32,
    pub auto_approve: bool,
}

impl Default for TaskConfig {
    fn default() -> Self {
        Self {
            max_concurrent_agents: 3,
            timeout_seconds: 3600,
            auto_approve: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskFile {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub topology: TaskTopology,
    pub state: TaskState,
    #[serde(default = "now")]
    pub created_at: DateTime<Utc>,
    #[serde(default = "now")]
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub milestones: Vec<Milestone>,
    #[serde(default)]
    pub roster: Vec<AgentInstance>,
    #[serde(default)]
    pub gates: Vec<Gate>,
    #[serde(default)]
    pub config: TaskConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub topology: TaskTopology,
    #[serde(default)]
    pub milestones: Vec<Milestone>,
    #[serde(default)]
    pub roster: Vec<AgentInstance>,
    pub config: Option<TaskConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskResponse {
    pub id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub ts: DateTime<Utc>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub task_id: String,
    pub agent_instance: Option<String>,
    pub turn_id: Option<String>,
    #[serde(default)]
    pub payload: serde_json::Value,
    pub by: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClusterStatus {
    pub orchestrator: String,
    pub codex_adapter: String,
    pub active_agents: u32,
    pub max_agents: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_instance_state_accepts_legacy_created() {
        let state: AgentInstanceState = serde_yaml::from_str("created").unwrap();
        assert_eq!(state, AgentInstanceState::Pending);
    }

    #[test]
    fn milestone_state_accepts_legacy_in_progress() {
        let state: MilestoneState = serde_yaml::from_str("in_progress").unwrap();
        assert_eq!(state, MilestoneState::Working);
    }

    #[test]
    fn task_state_accepts_legacy_gate_blocked() {
        let state: TaskState = serde_yaml::from_str("gate.blocked").unwrap();
        assert_eq!(state, TaskState::InputRequired);
    }

    #[test]
    fn task_state_accepts_legacy_cancelled() {
        let state: TaskState = serde_yaml::from_str("cancelled").unwrap();
        assert_eq!(state, TaskState::Canceled);
    }
}
