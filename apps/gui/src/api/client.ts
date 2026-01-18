import { invoke } from '@tauri-apps/api/core';
import type {
	ClusterStatus,
	CreateTaskRequest,
	CreateTaskResponse,
	SharedArtifactCategory,
	SharedArtifactContent,
	SharedArtifactSummary,
	SubagentFinalOutput,
	SubagentSessionSummary,
	TaskTextFileContent,
	Task,
	TaskEvent,
} from '../types/task';
import type { TaskDirectoryEntry } from '../types/sidebar';
import type {
	AutoContextInfo,
	CodexModelListResponse,
	CodexThreadLoadedListResponse,
	CodexThreadListResponse,
	CodexUserInput,
	FileInfo,
	PromptsListResponse,
	SkillsListResponse,
} from '../types/codex';

export async function listTasks(): Promise<Task[]> {
	return invoke<Task[]>('list_tasks');
}

export async function getTask(taskId: string): Promise<Task> {
	return invoke<Task>('get_task', { task_id: taskId });
}

export async function getTaskEvents(
	taskId: string,
	options: {
		limit: number;
		offset: number;
		eventTypePrefix?: string;
	}
): Promise<TaskEvent[]> {
	return invoke<TaskEvent[]>('get_task_events', {
		task_id: taskId,
		event_type_prefix: options.eventTypePrefix ?? null,
		limit: options.limit,
		offset: options.offset,
	});
}

export async function createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {
	return invoke<CreateTaskResponse>('create_task', {
		req: {
			title: req.title,
			description: req.description ?? '',
			topology: req.topology,
			roster: req.roster ?? [],
		},
	});
}

export async function getClusterStatus(): Promise<ClusterStatus> {
	return invoke<ClusterStatus>('cluster_status');
}

export async function listSubagentSessions(taskId: string): Promise<SubagentSessionSummary[]> {
	return invoke<SubagentSessionSummary[]>('list_subagent_sessions', {
		task_id: taskId,
	});
}

export async function getSubagentFinalOutput(taskId: string, agentInstance: string): Promise<SubagentFinalOutput> {
	return invoke<SubagentFinalOutput>('get_subagent_final_output', {
		task_id: taskId,
		agent_instance: agentInstance,
	});
}

export async function tailSubagentEvents(taskId: string, agentInstance: string, limit: number): Promise<string[]> {
	return invoke<string[]>('tail_subagent_events', {
		task_id: taskId,
		agent_instance: agentInstance,
		limit,
	});
}

export async function tailSubagentStderr(taskId: string, agentInstance: string, limit: number): Promise<string[]> {
	return invoke<string[]>('tail_subagent_stderr', {
		task_id: taskId,
		agent_instance: agentInstance,
		limit,
	});
}

export async function taskReadTextFile(taskId: string, path: string, maxBytes?: number | null): Promise<TaskTextFileContent> {
	return invoke<TaskTextFileContent>('task_read_text_file', {
		task_id: taskId,
		path,
		max_bytes: maxBytes ?? null,
	});
}

export async function taskListDirectory(taskId: string, relativePath: string): Promise<TaskDirectoryEntry[]> {
	return invoke<TaskDirectoryEntry[]>('task_list_directory', {
		task_id: taskId,
		relative_path: relativePath,
	});
}

// Back-compat alias (some UI components use the shorter name)
export async function taskListDir(taskId: string, relativePath: string): Promise<TaskDirectoryEntry[]> {
	return taskListDirectory(taskId, relativePath);
}

export async function workspaceListDirectory(cwd: string, relativePath: string): Promise<TaskDirectoryEntry[]> {
	return invoke<TaskDirectoryEntry[]>('workspace_list_directory', {
		cwd,
		relative_path: relativePath,
	});
}

export async function listSharedArtifacts(taskId: string, category: SharedArtifactCategory): Promise<SharedArtifactSummary[]> {
	return invoke<SharedArtifactSummary[]>('list_shared_artifacts', {
		task_id: taskId,
		category,
	});
}

export async function readSharedArtifact(taskId: string, category: SharedArtifactCategory, path: string): Promise<SharedArtifactContent> {
	return invoke<SharedArtifactContent>('read_shared_artifact', {
		task_id: taskId,
		category,
		path,
	});
}

export async function codexAppServerEnsure(options?: {
	codexHome?: string | null;
	profile?: string | null;
}): Promise<{ appServerId: string }> {
	return invoke<{ appServerId: string }>('codex_app_server_ensure', {
		codexHome: options?.codexHome ?? null,
		profile: options?.profile ?? null,
	});
}

export async function codexAppServerShutdown(appServerId: string): Promise<void> {
	await invoke<void>('codex_app_server_shutdown', { appServerId });
}

export async function codexThreadList(cursor?: string | null, limit?: number | null, appServerId?: string | null): Promise<CodexThreadListResponse> {
	return invoke<CodexThreadListResponse>('codex_thread_list', {
		cursor: cursor ?? null,
		limit: limit ?? null,
		appServerId: appServerId ?? null,
	});
}

export async function codexThreadLoadedList(cursor?: string | null, limit?: number | null, appServerId?: string | null): Promise<CodexThreadLoadedListResponse> {
	return invoke<CodexThreadLoadedListResponse>('codex_thread_loaded_list', {
		cursor: cursor ?? null,
		limit: limit ?? null,
		appServerId: appServerId ?? null,
	});
}

export async function codexThreadTitleSet(threadId: string, title: string): Promise<void> {
	await invoke<void>('codex_thread_title_set', { threadId, title });
}

export async function codexThreadArchive(threadId: string, appServerId?: string | null): Promise<void> {
	await invoke<void>('codex_thread_archive', { threadId, appServerId: appServerId ?? null });
}

export async function codexThreadStart(model?: string | null, appServerId?: string | null): Promise<unknown> {
	return invoke<unknown>('codex_thread_start', { model: model ?? null, appServerId: appServerId ?? null });
}

export async function codexThreadResume(threadId: string, appServerId?: string | null): Promise<unknown> {
	return invoke<unknown>('codex_thread_resume', { threadId, appServerId: appServerId ?? null });
}

export async function codexThreadFork(
	threadId: string,
	options?: {
		path?: string | null;
		appServerId?: string | null;
	}
): Promise<unknown> {
	return invoke<unknown>('codex_thread_fork', {
		threadId,
		path: options?.path ?? null,
		appServerId: options?.appServerId ?? null,
	});
}

export async function codexThreadRollback(threadId: string, numTurns?: number | null, appServerId?: string | null): Promise<unknown> {
	return invoke<unknown>('codex_thread_rollback', {
		threadId,
		numTurns: numTurns ?? null,
		appServerId: appServerId ?? null,
	});
}

export async function codexTurnStart(
	threadId: string,
	input: CodexUserInput[],
	model?: string | null,
	effort?: string | null,
	approvalPolicy?: string | null,
	appServerId?: string | null
): Promise<unknown> {
	return invoke<unknown>('codex_turn_start', {
		threadId,
		input,
		model: model ?? null,
		effort: effort ?? null,
		approvalPolicy: approvalPolicy ?? null,
		appServerId: appServerId ?? null,
	});
}

export async function codexTurnInterrupt(threadId: string, turnId: string, appServerId?: string | null): Promise<unknown> {
	return invoke<unknown>('codex_turn_interrupt', {
		threadId,
		turnId,
		appServerId: appServerId ?? null,
	});
}

export async function codexRespondApproval(requestId: number, decision: 'accept' | 'decline', appServerId?: string | null): Promise<void> {
	await invoke<void>('codex_respond_approval', {
		requestId,
		decision,
		appServerId: appServerId ?? null,
	});
}

export async function codexModelList(cursor?: string | null, limit?: number | null, appServerId?: string | null): Promise<CodexModelListResponse> {
	return invoke<CodexModelListResponse>('codex_model_list', {
		cursor: cursor ?? null,
		limit: limit ?? null,
		appServerId: appServerId ?? null,
	});
}

export async function codexConfigReadEffective(includeLayers?: boolean | null, appServerId?: string | null): Promise<unknown> {
	return invoke<unknown>('codex_config_read_effective', {
		includeLayers: includeLayers ?? null,
		appServerId: appServerId ?? null,
	});
}

export async function codexConfigWriteChatDefaults(options: {
	model?: string | null;
	modelReasoningEffort?: string | null;
	approvalPolicy?: string | null;
	profile?: string | null;
	appServerId?: string | null;
}): Promise<unknown> {
	return invoke<unknown>('codex_config_write_chat_defaults', {
		model: options.model ?? null,
		modelReasoningEffort: options.modelReasoningEffort ?? null,
		approvalPolicy: options.approvalPolicy ?? null,
		profile: options.profile ?? null,
		appServerId: options.appServerId ?? null,
	});
}

export async function codexSetProfile(profile?: string | null): Promise<void> {
	await invoke<void>('codex_set_profile', {
		profile: profile ?? null,
	});
}

export async function codexReadConfig(): Promise<string> {
	return invoke<string>('codex_read_config');
}

export async function codexWriteConfig(content: string): Promise<void> {
	await invoke<void>('codex_write_config', { content });
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
	}>('codex_diagnostics');
}

export async function workspaceRootGet(): Promise<string> {
	return invoke<string>('workspace_root_get');
}

export async function workspaceRootSet(workspaceRoot: string): Promise<string> {
	return invoke<string>('workspace_root_set', {
		workspaceRoot,
	});
}

export async function workspaceRecentList(): Promise<string[]> {
	return invoke<string[]>('workspace_recent_list');
}

export async function windowNew(): Promise<string> {
	return invoke<string>('window_new');
}

// ============================================================================
// Context management APIs for Auto context, + button, / button
// ============================================================================

export async function searchWorkspaceFiles(cwd: string, query: string, limit?: number): Promise<FileInfo[]> {
	return invoke<FileInfo[]>('search_workspace_files', {
		cwd,
		query,
		limit: limit ?? null,
	});
}

export async function readFileContent(path: string): Promise<string> {
	return invoke<string>('read_file_content', { path });
}

export async function getAutoContext(cwd: string): Promise<AutoContextInfo> {
	return invoke<AutoContextInfo>('get_auto_context', { cwd });
}

export async function codexSkillList(appServerId?: string | null): Promise<SkillsListResponse> {
	return invoke<SkillsListResponse>('codex_skill_list', { appServerId: appServerId ?? null });
}

export async function codexPromptList(): Promise<PromptsListResponse> {
	return invoke<PromptsListResponse>('codex_prompt_list');
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
	tailSubagentStderr,
	taskReadTextFile,
	taskListDirectory,
	taskListDir,
	workspaceListDirectory,
	listSharedArtifacts,
	readSharedArtifact,
	codexAppServerEnsure,
	codexAppServerShutdown,
	codexThreadList,
	codexThreadTitleSet,
	codexThreadArchive,
	codexThreadStart,
	codexThreadResume,
	codexThreadFork,
	codexThreadRollback,
	codexTurnStart,
	codexTurnInterrupt,
	codexRespondApproval,
	codexModelList,
	codexConfigReadEffective,
	codexConfigWriteChatDefaults,
	codexSetProfile,
	codexReadConfig,
	codexWriteConfig,
	codexDiagnostics,
	codexSkillList,
	codexPromptList,
	codexThreadLoadedList,
	workspaceRootGet,
	workspaceRootSet,
	workspaceRecentList,
	windowNew,
	// Context management APIs
	searchWorkspaceFiles,
	readFileContent,
	getAutoContext,
};

export default apiClient;
