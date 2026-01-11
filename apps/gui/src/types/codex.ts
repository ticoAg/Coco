export type CodexJsonRpcEventKind =
  | 'notification'
  | 'request'
  | 'stderr'
  | 'error'
  | 'unknown'

export interface CodexJsonRpcEvent {
  kind: CodexJsonRpcEventKind
  message: unknown
}

export interface CodexThreadSummary {
  id: string
  preview: string
  modelProvider: string
  createdAt: number
  updatedAtMs: number | null
}

export interface CodexThreadListResponse {
  data: CodexThreadSummary[]
  nextCursor: string | null
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ReasoningEffortOption {
  reasoningEffort: ReasoningEffort
  description: string
}

export interface CodexModelInfo {
  id: string
  model: string
  displayName: string
  description: string
  supportedReasoningEfforts: ReasoningEffortOption[]
  defaultReasoningEffort: ReasoningEffort
  isDefault: boolean
}

export interface CodexModelListResponse {
  data: CodexModelInfo[]
  nextCursor: string | null
}

export type CodexUserInput =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }
  | { type: 'skill'; name: string; path: string }

export type CodexThreadItem =
  | { type: 'userMessage'; id: string; content: CodexUserInput[] }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution'
      id: string
      command: string
      cwd: string
      processId: string | null
      status: 'inProgress' | 'completed' | 'failed' | 'declined'
      commandActions: unknown[]
      aggregatedOutput: string | null
      exitCode: number | null
      durationMs: number | null
    }
  | {
      type: 'fileChange'
      id: string
      changes: Array<{ path: string; kind: unknown; diff: string }>
      status: 'inProgress' | 'completed' | 'failed' | 'declined'
    }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      status: 'inProgress' | 'completed' | 'failed'
      arguments: unknown
      result?: { content: unknown[]; structuredContent?: unknown } | null
      error?: { message: string } | null
      durationMs: number | null
    }
  | { type: 'webSearch'; id: string; query: string }
  | { type: 'imageView'; id: string; path: string }
  | { type: 'enteredReviewMode'; id: string; review: string }
  | { type: 'exitedReviewMode'; id: string; review: string }

export interface CodexTurn {
  id: string
  items: CodexThreadItem[]
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress'
  error: { message: string } | null
}

export interface CodexThread {
  id: string
  preview: string
  modelProvider: string
  createdAt: number
  path: string
  cwd: string
  cliVersion: string
  source: string
  turns: CodexTurn[]
}

// ============================================================================
// Context management types for Auto context, + button, / button
// ============================================================================

export interface FileInfo {
  path: string
  name: string
  isDirectory: boolean
}

export interface GitStatus {
  branch: string
  modified: string[]
  staged: string[]
}

export interface AutoContextInfo {
  cwd: string
  recentFiles: string[]
  gitStatus: GitStatus | null
}

export interface FileAttachment {
  path: string
  name: string
  content?: string
}

