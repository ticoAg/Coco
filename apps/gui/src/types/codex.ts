export type CodexJsonRpcEventKind = 'notification' | 'request' | 'stderr' | 'error' | 'unknown';

export interface CodexJsonRpcEvent {
	appServerId: string;
	kind: CodexJsonRpcEventKind;
	message: unknown;
}

export interface CodexThreadSummary {
	id: string;
	preview: string;
	title?: string | null;
	modelProvider: string;
	createdAt: number;
	updatedAtMs: number | null;
	interactionCount?: number | null;
}

export interface CodexThreadListResponse {
	data: CodexThreadSummary[];
	nextCursor: string | null;
}

export interface CodexThreadLoadedListResponse {
	data: string[];
	nextCursor: string | null;
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ReasoningEffortOption {
	reasoningEffort: ReasoningEffort;
	description: string;
}

export interface CodexModelInfo {
	id: string;
	model: string;
	displayName: string;
	description: string;
	supportedReasoningEfforts: ReasoningEffortOption[];
	defaultReasoningEffort: ReasoningEffort;
	isDefault: boolean;
}

export interface CodexModelListResponse {
	data: CodexModelInfo[];
	nextCursor: string | null;
}

export type CodexUserInput =
	| { type: 'text'; text: string }
	| { type: 'image'; url: string }
	| { type: 'localImage'; path: string }
	| { type: 'skill'; name: string; path: string };

export type CommandAction =
	| { type: 'read'; command: string; name: string; path: string }
	| { type: 'listFiles'; command: string; path?: string | null }
	| { type: 'search'; command: string; query?: string | null; path?: string | null }
	| { type: 'unknown'; command: string };

export type McpContentBlock =
	| { type: 'text'; text: string; annotations?: unknown }
	| { type: 'image'; data: string; mimeType: string; annotations?: unknown }
	| { type: 'audio'; data: string; mimeType: string; annotations?: unknown }
	| {
			type: 'resource_link';
			uri: string;
			name: string;
			title?: string | null;
			description?: string | null;
			mimeType?: string | null;
			size?: number | null;
			annotations?: unknown;
	  }
	| {
			type: 'resource' | 'embedded_resource';
			resource: {
				uri: string;
				mimeType?: string | null;
				text?: string;
				blob?: string;
			};
			annotations?: unknown;
	  };

export type McpToolCallResult = {
	content: McpContentBlock[];
	structuredContent?: unknown | null;
};

export type McpToolCallError = { message: string };

export type CodexThreadItem =
	| { type: 'userMessage'; id: string; content: CodexUserInput[] }
	| { type: 'agentMessage'; id: string; text: string }
	| { type: 'reasoning'; id: string; summary: string[]; content: string[] }
	| {
			type: 'error';
			id: string;
			message: string;
			willRetry?: boolean | null;
			additionalDetails?: string | null;
	  }
	| {
			type: 'commandExecution';
			id: string;
			command: string;
			cwd: string;
			processId: string | null;
			status: 'inProgress' | 'completed' | 'failed' | 'declined';
			commandActions: CommandAction[];
			aggregatedOutput: string | null;
			exitCode: number | null;
			durationMs: number | null;
	  }
	| {
			type: 'fileChange';
			id: string;
			changes: Array<{ path: string; kind: unknown; diff: string; lineNumbersAvailable?: boolean }>;
			status: 'inProgress' | 'completed' | 'failed' | 'declined';
	  }
	| {
			type: 'mcpToolCall';
			id: string;
			server: string;
			tool: string;
			status: 'inProgress' | 'completed' | 'failed';
			arguments: unknown;
			result?: McpToolCallResult | null;
			error?: McpToolCallError | null;
			durationMs: number | null;
	  }
	| { type: 'webSearch'; id: string; query: string }
	| { type: 'imageView'; id: string; path: string }
	| {
			type: 'collabAgentToolCall';
			id: string;
			tool: 'spawnAgent' | 'sendInput' | 'wait' | 'closeAgent';
			status: 'inProgress' | 'completed' | 'failed';
			senderThreadId: string;
			receiverThreadIds: string[];
			prompt?: string | null;
			agentsStates: Record<
				string,
				{
					status: 'pendingInit' | 'running' | 'completed' | 'errored' | 'shutdown' | 'notFound';
					message?: string | null;
				}
			>;
	  }
	| { type: 'enteredReviewMode'; id: string; review: string }
	| { type: 'exitedReviewMode'; id: string; review: string };

export interface CodexTurn {
	id: string;
	items: CodexThreadItem[];
	status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
	error: { message: string } | null;
}

export interface CodexThread {
	id: string;
	preview: string;
	modelProvider: string;
	createdAt: number;
	path: string;
	cwd: string;
	cliVersion: string;
	source: string;
	turns: CodexTurn[];
}

// ============================================================================
// Context management types for Auto context, + button, / button
// ============================================================================

export interface FileInfo {
	path: string;
	name: string;
	isDirectory: boolean;
}

export interface GitStatus {
	branch: string;
	modified: string[];
	staged: string[];
}

export interface AutoContextInfo {
	cwd: string;
	recentFiles: string[];
	gitStatus: GitStatus | null;
}

export interface FileAttachment {
	path: string;
	name: string;
	content?: string;
}

// Skills types
export interface SkillMetadata {
	name: string;
	description: string;
	shortDescription?: string;
	path: string;
	scope: 'user' | 'repo' | 'system' | 'admin';
}

export interface SkillsListResponse {
	skills: SkillMetadata[];
}

// Prompts types (custom prompts from ~/.codex/prompts/)
export interface CustomPrompt {
	name: string;
	description?: string;
	argumentHint?: string;
	path: string;
}

export interface PromptsListResponse {
	prompts: CustomPrompt[];
}
