/**
 * AgentMesh Task Types
 * Based on API specifications from gui.md
 */

// Task state enum (matches backend TaskState)
export type TaskState = 'created' | 'working' | 'gate.blocked' | 'completed' | 'failed';

// Topology types
export type TopologyType = 'swarm' | 'squad';

// Agent lifecycle states
export type AgentState = 'active' | 'awaiting' | 'dormant';

// Agent instance within a task
export interface AgentInstance {
  id: string;
  name: string;
  role: string;
  state: AgentState;
  sessionId?: string;
  cwd?: string;
  artifacts?: string[];
}

// Milestone definition
export interface Milestone {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  completedAt?: string;
}

// Gate definition (approval points)
export interface Gate {
  id: string;
  type: 'approval' | 'decision' | 'review';
  title: string;
  description?: string;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  resolvedAt?: string;
  payload?: Record<string, unknown>;
}

// Task event types
export type EventType =
  | 'task.created'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.error'
  | 'turn.started'
  | 'turn.completed'
  | 'gate.created'
  | 'gate.resolved'
  | 'artifact.created'
  | 'artifact.updated'
  | 'milestone.completed';

// Event structure
export interface TaskEvent {
  id: string;
  type: EventType;
  timestamp: string;
  sessionId?: string;
  turnId?: string;
  agentId?: string;
  payload: Record<string, unknown>;
}

// Task report
export interface Report {
  id: string;
  title: string;
  path: string;
  type: 'diagnostic' | 'summary' | 'analysis';
  createdAt: string;
  updatedAt: string;
}

// Task contract
export interface Contract {
  id: string;
  title: string;
  path: string;
  type: 'api' | 'schema' | 'error-model';
  version?: string;
  createdAt: string;
  updatedAt: string;
}

// Task decision (ADR)
export interface Decision {
  id: string;
  title: string;
  path: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  createdAt: string;
  updatedAt: string;
}

// Main Task interface
export interface Task {
  id: string;
  title: string;
  description?: string;
  state: TaskState;
  topology: TopologyType;
  roster: AgentInstance[];
  milestones: Milestone[];
  gates: Gate[];
  createdAt: string;
  updatedAt: string;
  // Optional extended data
  reports?: Report[];
  contracts?: Contract[];
  decisions?: Decision[];
}

// API Response types
export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

export interface TaskDetailResponse {
  task: Task;
  events?: TaskEvent[];
}

export interface TaskEventsResponse {
  events: TaskEvent[];
  hasMore: boolean;
  cursor?: string;
}

// Create task request
export interface CreateTaskRequest {
  title: string;
  description?: string;
  topology: TopologyType;
  agents?: {
    name: string;
    role: string;
  }[];
}

// Gate decision request
export interface GateDecisionRequest {
  decision: 'approve' | 'deny';
  comment?: string;
}

// API Error response
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Cluster status
export interface ClusterStatus {
  orchestrator: 'online' | 'offline';
  codexAdapter: 'connected' | 'disconnected';
  activeAgents: number;
  maxAgents: number;
}
