import { invoke } from "@tauri-apps/api/core";
import type {
  ClusterStatus,
  CreateTaskRequest,
  CreateTaskResponse,
  SharedArtifactCategory,
  SharedArtifactContent,
  SharedArtifactSummary,
  SubagentFinalOutput,
  SubagentSessionSummary,
  Task,
  TaskEvent,
} from "../types/task";
import type {
  AutoContextInfo,
  CodexModelListResponse,
  CodexThreadListResponse,
  FileInfo,
} from "../types/codex";

export async function listTasks(): Promise<Task[]> {
  return invoke<Task[]>("list_tasks");
}

export async function getTask(taskId: string): Promise<Task> {
  return invoke<Task>("get_task", { task_id: taskId });
}

export async function getTaskEvents(
  taskId: string,
  options: {
    limit: number;
    offset: number;
    eventTypePrefix?: string;
  },
): Promise<TaskEvent[]> {
  return invoke<TaskEvent[]>("get_task_events", {
    task_id: taskId,
    event_type_prefix: options.eventTypePrefix ?? null,
    limit: options.limit,
    offset: options.offset,
  });
}

export async function createTask(
  req: CreateTaskRequest,
): Promise<CreateTaskResponse> {
  return invoke<CreateTaskResponse>("create_task", {
    req: {
      title: req.title,
      description: req.description ?? "",
      topology: req.topology,
      roster: req.roster ?? [],
    },
  });
}

export async function getClusterStatus(): Promise<ClusterStatus> {
  return invoke<ClusterStatus>("cluster_status");
}

export async function listSubagentSessions(
  taskId: string,
): Promise<SubagentSessionSummary[]> {
  return invoke<SubagentSessionSummary[]>("list_subagent_sessions", {
    task_id: taskId,
  });
}

export async function getSubagentFinalOutput(
  taskId: string,
  agentInstance: string,
): Promise<SubagentFinalOutput> {
  return invoke<SubagentFinalOutput>("get_subagent_final_output", {
    task_id: taskId,
    agent_instance: agentInstance,
  });
}

export async function tailSubagentEvents(
  taskId: string,
  agentInstance: string,
  limit: number,
): Promise<string[]> {
  return invoke<string[]>("tail_subagent_events", {
    task_id: taskId,
    agent_instance: agentInstance,
    limit,
  });
}

export async function listSharedArtifacts(
  taskId: string,
  category: SharedArtifactCategory,
): Promise<SharedArtifactSummary[]> {
  return invoke<SharedArtifactSummary[]>("list_shared_artifacts", {
    task_id: taskId,
    category,
  });
}

export async function readSharedArtifact(
  taskId: string,
  category: SharedArtifactCategory,
  path: string,
): Promise<SharedArtifactContent> {
  return invoke<SharedArtifactContent>("read_shared_artifact", {
    task_id: taskId,
    category,
    path,
  });
}

export async function codexThreadList(
  cursor?: string | null,
  limit?: number | null,
): Promise<CodexThreadListResponse> {
  return invoke<CodexThreadListResponse>("codex_thread_list", {
    cursor: cursor ?? null,
    limit: limit ?? null,
  });
}

export async function codexThreadStart(
  model?: string | null,
): Promise<unknown> {
  return invoke<unknown>("codex_thread_start", { model: model ?? null });
}

export async function codexThreadResume(threadId: string): Promise<unknown> {
  return invoke<unknown>("codex_thread_resume", { thread_id: threadId });
}

export async function codexTurnStart(
  threadId: string,
  text: string,
  model?: string | null,
  effort?: string | null,
  approvalPolicy?: string | null,
): Promise<unknown> {
  return invoke<unknown>("codex_turn_start", {
    thread_id: threadId,
    text,
    model: model ?? null,
    effort: effort ?? null,
    approval_policy: approvalPolicy ?? null,
  });
}

export async function codexTurnInterrupt(
  threadId: string,
  turnId: string,
): Promise<unknown> {
  return invoke<unknown>("codex_turn_interrupt", {
    thread_id: threadId,
    turn_id: turnId,
  });
}

export async function codexRespondApproval(
  requestId: number,
  decision: "accept" | "decline",
): Promise<void> {
  await invoke<void>("codex_respond_approval", {
    request_id: requestId,
    decision,
  });
}

export async function codexModelList(
  cursor?: string | null,
  limit?: number | null,
): Promise<CodexModelListResponse> {
  return invoke<CodexModelListResponse>("codex_model_list", {
    cursor: cursor ?? null,
    limit: limit ?? null,
  });
}

export async function codexConfigReadEffective(
  includeLayers?: boolean | null,
): Promise<unknown> {
  return invoke<unknown>("codex_config_read_effective", {
    include_layers: includeLayers ?? null,
  });
}

export async function codexConfigWriteChatDefaults(options: {
  model?: string | null;
  modelReasoningEffort?: string | null;
  approvalPolicy?: string | null;
}): Promise<unknown> {
  return invoke<unknown>("codex_config_write_chat_defaults", {
    model: options.model ?? null,
    model_reasoning_effort: options.modelReasoningEffort ?? null,
    approval_policy: options.approvalPolicy ?? null,
  });
}

export async function codexReadConfig(): Promise<string> {
  return invoke<string>("codex_read_config");
}

export async function codexWriteConfig(content: string): Promise<void> {
  await invoke<void>("codex_write_config", { content });
}

export async function codexDiagnostics(): Promise<{
  path: string;
  resolvedCodexBin: string | null;
  envOverride: string | null;
  pathSource: string;
  shell: string | null;
  envSource: string;
  envCount: number;
}> {
  return invoke<{
    path: string;
    resolvedCodexBin: string | null;
    envOverride: string | null;
    pathSource: string;
    shell: string | null;
    envSource: string;
    envCount: number;
  }>("codex_diagnostics");
}

// ============================================================================
// Context management APIs for Auto context, + button, / button
// ============================================================================

export async function searchWorkspaceFiles(
  cwd: string,
  query: string,
  limit?: number,
): Promise<FileInfo[]> {
  return invoke<FileInfo[]>("search_workspace_files", {
    cwd,
    query,
    limit: limit ?? null,
  });
}

export async function readFileContent(path: string): Promise<string> {
  return invoke<string>("read_file_content", { path });
}

export async function getAutoContext(cwd: string): Promise<AutoContextInfo> {
  return invoke<AutoContextInfo>("get_auto_context", { cwd });
}

export const apiClient = {
  listTasks,
  getTask,
  getTaskEvents,
  createTask,
  getClusterStatus,
  listSubagentSessions,
  getSubagentFinalOutput,
  tailSubagentEvents,
  listSharedArtifacts,
  readSharedArtifact,
  codexThreadList,
  codexThreadStart,
  codexThreadResume,
  codexTurnStart,
  codexTurnInterrupt,
  codexRespondApproval,
  codexModelList,
  codexConfigReadEffective,
  codexConfigWriteChatDefaults,
  codexReadConfig,
  codexWriteConfig,
  codexDiagnostics,
  // Context management APIs
  searchWorkspaceFiles,
  readFileContent,
  getAutoContext,
};

export default apiClient;
