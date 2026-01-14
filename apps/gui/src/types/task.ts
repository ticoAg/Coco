// Types mirrored from `agentmesh-core` (Rust) for Tauri IPC.

export type TaskTopology = 'swarm' | 'squad';

export type TaskState = 'created' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';

export type MilestoneState = 'pending' | 'working' | 'done' | 'blocked';

export interface Milestone {
	id: string;
	title: string;
	state: MilestoneState;
	dependsOn: string[];
}

export type AgentInstanceState = 'pending' | 'active' | 'awaiting' | 'dormant' | 'completed' | 'failed';

export interface AgentInstance {
	instance: string;
	agent: string;
	state: AgentInstanceState;
	assignedMilestone: string | null;
	skills: string[];
}

export type GateType = 'human-approval' | 'auto-check' | 'milestone-gate';

export type GateState = 'open' | 'blocked' | 'approved' | 'rejected';

export interface Gate {
	id: string;
	type: GateType;
	state: GateState;
	reason: string;
	instructionsRef: string | null;
	blockedAt: string | null;
	resolvedAt: string | null;
	resolvedBy: string | null;
}

export interface TaskConfig {
	maxConcurrentAgents: number;
	timeoutSeconds: number;
	autoApprove: boolean;
}

export interface Task {
	id: string;
	title: string;
	description: string;
	topology: TaskTopology;
	state: TaskState;
	createdAt: string;
	updatedAt: string;
	milestones: Milestone[];
	roster: AgentInstance[];
	gates: Gate[];
	config: TaskConfig;
}

export interface TaskEvent {
	ts: string;
	type: string;
	taskId: string;
	agentInstance: string | null;
	turnId: string | null;
	payload: unknown;
	by: string | null;
	path: string | null;
}

export interface CreateTaskRequest {
	title: string;
	description?: string;
	topology: TaskTopology;
	roster?: Array<{
		instance: string;
		agent: string;
	}>;
}

export interface CreateTaskResponse {
	id: string;
	message: string;
}

export interface ClusterStatus {
	orchestrator: string;
	codexAdapter: string;
	activeAgents: number;
	maxAgents: number;
}

// ============ Subagent / Sessions (GUI only) ============

export type SubagentSessionStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'unknown';

export interface SubagentSessionSummary {
	agentInstance: string;
	status: SubagentSessionStatus;
	lastUpdatedAtMs: number | null;
	adapter: string | null;
	hasFinal: boolean;
	hasEvents: boolean;
}

export interface SubagentFinalOutput {
	exists: boolean;
	json: unknown | null;
	parseError: string | null;
}

// ============ Shared Artifacts (GUI only) ============

export type SharedArtifactCategory = 'reports' | 'contracts' | 'decisions';

export interface SharedArtifactSummary {
	path: string;
	filename: string;
	updatedAtMs: number | null;
	sizeBytes: number | null;
}

export interface SharedArtifactContent {
	path: string;
	content: string;
	updatedAtMs: number | null;
}
