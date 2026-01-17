import type { CommandAction, McpToolCallError, McpToolCallResult } from '../../../types/codex';
import type { parseCodeReviewStructuredOutputFromMessage } from '../assistantMessage';

/** 附加内容类型 */
export type AttachmentItem = { type: 'file'; path: string; name: string } | { type: 'skill'; name: string } | { type: 'prompt'; name: string };

export type CollabAgentState = {
	status: 'pendingInit' | 'running' | 'completed' | 'errored' | 'shutdown' | 'notFound';
	message?: string | null;
};

export type AssistantBaseEntry = {
	kind: 'assistant';
	id: string;
	text: string;
	streaming?: boolean;
	completed?: boolean;
	renderPlaceholderWhileStreaming?: boolean;
	structuredOutput?: ReturnType<typeof parseCodeReviewStructuredOutputFromMessage> | null;
	reasoningSummary?: string[];
	reasoningContent?: string[];
};

export type AssistantMessageEntry = AssistantBaseEntry & {
	role: 'message';
};

export type AssistantReasoningEntry = AssistantBaseEntry & {
	role: 'reasoning';
};

export type ChatEntry =
	| {
			kind: 'user';
			id: string;
			text: string;
			attachments?: AttachmentItem[];
	  }
	| AssistantMessageEntry
	| AssistantReasoningEntry
	| {
			kind: 'command';
			id: string;
			command: string;
			status: string;
			cwd?: string;
			output?: string | null;
			commandActions?: CommandAction[];
			approval?: {
				requestId: number;
				decision?: 'accept' | 'decline';
				reason?: string | null;
			};
	  }
	| {
			kind: 'fileChange';
			id: string;
			status: string;
			changes: Array<{ path: string; diff?: string; kind?: unknown; lineNumbersAvailable?: boolean }>;
			approval?: {
				requestId: number;
				decision?: 'accept' | 'decline';
				reason?: string | null;
			};
	  }
	| {
			kind: 'webSearch';
			id: string;
			query: string;
	  }
	| {
			kind: 'collab';
			id: string;
			tool: 'spawnAgent' | 'sendInput' | 'wait' | 'closeAgent';
			status: 'inProgress' | 'completed' | 'failed';
			senderThreadId: string;
			receiverThreadIds: string[];
			prompt?: string | null;
			agentsStates?: Record<string, CollabAgentState>;
	  }
	| {
			kind: 'mcp';
			id: string;
			server: string;
			tool: string;
			arguments?: unknown;
			result?: McpToolCallResult | null;
			error?: McpToolCallError | null;
			durationMs?: number | null;
			status: string;
			message?: string;
	  }
	| {
			kind: 'system';
			id: string;
			text: string;
			tone?: 'info' | 'warning' | 'error';
			willRetry?: boolean | null;
			additionalDetails?: string | null;
	  };

export type CodexChatSettings = {
	showReasoning: boolean;
	defaultCollapseDetails: boolean;
};
