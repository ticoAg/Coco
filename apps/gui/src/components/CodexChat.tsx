import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Brain,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Loader2,
  Menu,
  Paperclip,
  Plus,
  Search,
  Settings2,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SignalZero,
  Slash,
  Users,
  X,
  Zap,
} from "lucide-react";
import type {
  AutoContextInfo,
  CodexJsonRpcEvent,
  CodexModelInfo,
  CodexThread,
  CodexThreadItem,
  CodexThreadSummary,
  CodexUserInput,
  FileAttachment,
  FileInfo,
  ReasoningEffort,
} from "../types/codex";
import { apiClient } from "../api/client";

type ChatEntry =
  | {
      kind: "user";
      id: string;
      text: string;
    }
  | {
      kind: "assistant";
      id: string;
      text: string;
      role: "message" | "reasoning";
      streaming?: boolean;
    }
  | {
      kind: "command";
      id: string;
      command: string;
      status: string;
      cwd?: string;
      output?: string | null;
      approval?: {
        requestId: number;
        decision?: "accept" | "decline";
        reason?: string | null;
      };
    }
  | {
      kind: "fileChange";
      id: string;
      status: string;
      changes: Array<{ path: string; diff?: string }>;
      approval?: {
        requestId: number;
        decision?: "accept" | "decline";
        reason?: string | null;
      };
    }
  | {
      kind: "webSearch";
      id: string;
      query: string;
    }
  | {
      kind: "mcp";
      id: string;
      server: string;
      tool: string;
      status: string;
      message?: string;
    }
  | {
      kind: "system";
      id: string;
      text: string;
      tone?: "info" | "warning" | "error";
    };

type CodexChatSettings = {
  showReasoning: boolean;
  defaultCollapseDetails: boolean;
};

const SETTINGS_STORAGE_KEY = "agentmesh.codexChat.settings.v1";

function loadCodexChatSettings(): CodexChatSettings {
  const defaults: CodexChatSettings = {
    showReasoning: false,
    defaultCollapseDetails: false,
  };

  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<CodexChatSettings>;
    return {
      showReasoning: Boolean(parsed.showReasoning),
      defaultCollapseDetails: Boolean(parsed.defaultCollapseDetails),
    };
  } catch {
    return defaults;
  }
}

function persistCodexChatSettings(next: CodexChatSettings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function isCollapsibleEntry(
  entry: ChatEntry,
): entry is Extract<ChatEntry, { kind: "command" | "fileChange" }> {
  return entry.kind === "command" || entry.kind === "fileChange";
}

type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";

function repoNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function wrapUserInputWithRepoContext(options: {
  userInput: string;
  currentRepoPath: string | null;
  relatedRepoPaths: string[];
}): string {
  const lines: string[] = ["# Context from my IDE setup:", ""];
  if (options.currentRepoPath) {
    lines.push(`## Current repo: ${options.currentRepoPath}`);
  }
  for (const path of options.relatedRepoPaths) {
    lines.push(`## Related repo: ${path}`);
  }
  lines.push("", "## My request for Codex:", options.userInput);
  return lines.join("\n");
}

function reasoningEffortLabelEn(effort: ReasoningEffort): string {
  switch (effort) {
    case "none":
      return "None";
    case "minimal":
      return "Minimal";
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "Extra high";
    default:
      return effort;
  }
}

function translateReasoningDesc(desc: string): string {
  // 翻译 Codex API 返回的原始英文描述
  const translations: Record<string, string> = {
    // Low
    "Fast responses with lighter reasoning": "快速响应，轻量推理",
    "Fastest responses with limited reasoning": "最快响应，有限推理",
    "Balances speed with some reasoning; useful for straightforward queries and short explanations":
      "平衡速度与推理；适合简单查询和简短解释",
    // Medium
    "Balances speed and reasoning depth for everyday tasks":
      "平衡速度与推理深度，适合日常任务",
    "Dynamically adjusts reasoning based on the task":
      "根据任务动态调整推理深度",
    "Provides a solid balance of reasoning depth and latency for general-purpose tasks":
      "为通用任务提供推理深度与延迟的良好平衡",
    // High
    "Greater reasoning depth for complex problems":
      "更深的推理深度，适合复杂问题",
    "Maximizes reasoning depth for complex or ambiguous problems":
      "最大化推理深度，适合复杂或模糊问题",
    // XHigh
    "Extra high reasoning depth for complex problems":
      "超高推理深度，适合复杂问题",
    // Minimal
    "Fastest responses with little reasoning": "最快响应，几乎不进行推理",
  };
  return translations[desc] || desc;
}

function parseApprovalPolicyValue(value: unknown): ApprovalPolicy | null {
  if (
    value === "untrusted" ||
    value === "on-failure" ||
    value === "on-request" ||
    value === "never"
  )
    return value;
  return null;
}

function parseReasoningEffortValue(value: unknown): ReasoningEffort | null {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return null;
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(/\\.0$/, "")}m`;
  if (abs >= 1_000)
    return `${(value / 1_000).toFixed(1).replace(/\\.0$/, "")}k`;
  return String(Math.round(value));
}

function statusBarItemClass(active: boolean): string {
  return [
    "inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-2 text-[11px] transition",
    active
      ? "bg-bg-panelHover text-text-main"
      : "text-text-muted hover:bg-bg-panelHover hover:text-text-main",
  ].join(" ");
}

function reasoningEffortIcon(
  effort: ReasoningEffort,
  className = "h-3 w-3",
): JSX.Element {
  switch (effort) {
    case "none":
    case "minimal":
      return <SignalZero className={className} />;
    case "low":
      return <SignalLow className={className} />;
    case "medium":
      return <SignalMedium className={className} />;
    case "high":
      return <SignalHigh className={className} />;
    case "xhigh":
      return (
        <span className={`relative inline-flex ${className}`}>
          <SignalHigh className="h-full w-full" />
          <Plus className="absolute -right-1 -top-1 h-2 w-2" />
        </span>
      );
    default:
      return <Brain className={className} />;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string") return err || fallback;
  try {
    return JSON.stringify(err);
  } catch {
    return fallback;
  }
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isCodexTextInput(
  value: CodexUserInput,
): value is Extract<CodexUserInput, { type: "text" }> {
  return (
    value.type === "text" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function extractUserText(
  item: Extract<CodexThreadItem, { type: "userMessage" }>,
): string {
  const parts = item.content.filter(isCodexTextInput).map((c) => c.text);
  return parts.join("\n").trim();
}

function entryFromThreadItem(item: CodexThreadItem): ChatEntry | null {
  switch (item.type) {
    case "userMessage":
      return { kind: "user", id: item.id, text: extractUserText(item) };
    case "agentMessage":
      return {
        kind: "assistant",
        id: item.id,
        role: "message",
        text: item.text,
      };
    case "reasoning":
      return {
        kind: "assistant",
        id: item.id,
        role: "reasoning",
        text: [...(item.summary ?? []), ...(item.content ?? [])]
          .filter(Boolean)
          .join("\n"),
      };
    case "commandExecution":
      return {
        kind: "command",
        id: item.id,
        command: item.command,
        status: item.status,
        cwd: item.cwd,
        output: item.aggregatedOutput ?? null,
      };
    case "fileChange":
      return {
        kind: "fileChange",
        id: item.id,
        status: item.status,
        changes: item.changes.map((c) => ({ path: c.path, diff: c.diff })),
      };
    case "webSearch":
      return { kind: "webSearch", id: item.id, query: item.query };
    case "mcpToolCall":
      return {
        kind: "mcp",
        id: item.id,
        server: item.server,
        tool: item.tool,
        status: item.status,
      };
    default:
      return null;
  }
}

function mergeEntry(entries: ChatEntry[], next: ChatEntry): ChatEntry[] {
  const idx = entries.findIndex(
    (e) => e.id === next.id && e.kind === next.kind,
  );
  if (idx === -1) return [...entries, next];
  const copy = [...entries];
  copy[idx] = { ...copy[idx], ...next } as ChatEntry;
  return copy;
}

function appendDelta(
  entries: ChatEntry[],
  id: string,
  role: "message" | "reasoning",
  delta: string,
): ChatEntry[] {
  const idx = entries.findIndex(
    (e) => e.kind === "assistant" && e.id === id && e.role === role,
  );
  if (idx === -1) {
    return [
      ...entries,
      { kind: "assistant", id, role, text: delta, streaming: true },
    ];
  }
  const copy = [...entries];
  const existing = copy[idx] as Extract<ChatEntry, { kind: "assistant" }>;
  copy[idx] = {
    ...existing,
    text: `${existing.text}${delta}`,
    streaming: true,
  };
  return copy;
}

function formatSessionUpdatedAtMs(session: CodexThreadSummary): string {
  const updated = session.updatedAtMs
    ? new Date(session.updatedAtMs).toLocaleString()
    : "—";
  return updated;
}

function normalizeThreadFromResponse(res: unknown): CodexThread | null {
  if (!res || typeof res !== "object") return null;
  const obj = res as Record<string, unknown>;
  const thread = obj.thread;
  if (!thread || typeof thread !== "object") return null;
  return thread as CodexThread;
}

type TurnBlockStatus =
  | "inProgress"
  | "completed"
  | "failed"
  | "interrupted"
  | "unknown";

type TurnBlock = {
  id: string;
  status: TurnBlockStatus;
  entries: ChatEntry[];
};

const PENDING_TURN_ID = "__pending__";

function isActivityEntry(
  entry: ChatEntry,
): entry is Extract<
  ChatEntry,
  { kind: "command" | "fileChange" | "mcp" | "webSearch" }
> {
  return (
    entry.kind === "command" ||
    entry.kind === "fileChange" ||
    entry.kind === "mcp" ||
    entry.kind === "webSearch"
  );
}

function parseTurnStatus(value: unknown): TurnBlockStatus {
  if (typeof value !== "string") return "unknown";
  if (value === "inProgress") return "inProgress";
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "interrupted") return "interrupted";
  return "unknown";
}

function turnStatusLabel(status: TurnBlockStatus): string {
  switch (status) {
    case "inProgress":
      return "Working…";
    case "completed":
      return "Finished working";
    case "failed":
      return "Failed";
    case "interrupted":
      return "Interrupted";
    default:
      return "Turn";
  }
}

// Slash Commands definition
type SlashCommand = {
  id: string;
  label: string;
  description: string;
};

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "new", label: "/new", description: "创建新会话" },
  { id: "clear", label: "/clear", description: "清空当前对话" },
  { id: "context", label: "/context", description: "切换 Auto context" },
  { id: "status", label: "/status", description: "查看当前状态" },
  { id: "feedback", label: "/feedback", description: "发送反馈" },
  { id: "review", label: "/review", description: "进入 review 模式" },
];

export function CodexChat() {
  const [settings, setSettings] = useState<CodexChatSettings>(() =>
    loadCodexChatSettings(),
  );
  const [sessions, setSessions] = useState<CodexThreadSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);

  const [models, setModels] = useState<CodexModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<CodexThread | null>(null);
  const [threadTokenUsage, setThreadTokenUsage] = useState<{
    totalTokens: number;
    contextWindow: number | null;
  } | null>(null);
  const [turnOrder, setTurnOrder] = useState<string[]>([]);
  const [turnsById, setTurnsById] = useState<Record<string, TurnBlock>>({});
  const [collapsedActivityByTurnId, setCollapsedActivityByTurnId] = useState<
    Record<string, boolean>
  >({});
  const [collapsedRepliesByTurnId, setCollapsedRepliesByTurnId] = useState<
    Record<string, boolean>
  >({});
  const [_itemToTurnId, setItemToTurnId] = useState<Record<string, string>>({});
  const [collapsedByEntryId, setCollapsedByEntryId] = useState<
    Record<string, boolean>
  >({});
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort | null>(
    null,
  );
  const [approvalPolicy, setApprovalPolicy] =
    useState<ApprovalPolicy>("untrusted");
  const [openStatusPopover, setOpenStatusPopover] = useState<
    "profile" | "approval_policy" | "model" | "model_reasoning_effort" | null
  >(null);
  const [statusPopoverError, setStatusPopoverError] = useState<string | null>(
    null,
  );

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [configText, setConfigText] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [autoContextEnabled, setAutoContextEnabled] = useState(true);
  const [diagnostics, setDiagnostics] = useState<{
    path: string;
    resolvedCodexBin: string | null;
    envOverride: string | null;
    pathSource?: string;
    shell?: string | null;
    envSource?: string;
    envCount?: number;
  } | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceRootError, setWorkspaceRootError] = useState<string | null>(
    null,
  );
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const itemToTurnRef = useRef<Record<string, string>>({});
  const relatedRepoPathsByThreadIdRef = useRef<Record<string, string[]>>({});

  // Context management state
  const [autoContext, setAutoContext] = useState<AutoContextInfo | null>(null);
  const [relatedRepoPaths, setRelatedRepoPaths] = useState<string[]>([]);
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
  const [isAddContextOpen, setIsAddContextOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSearchResults, setFileSearchResults] = useState<FileInfo[]>([]);
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
  const [slashSearchQuery, setSlashSearchQuery] = useState("");
  const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    persistCodexChatSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!selectedThreadId) {
      setRelatedRepoPaths([]);
      return;
    }
    setRelatedRepoPaths(
      relatedRepoPathsByThreadIdRef.current[selectedThreadId] ?? [],
    );
  }, [selectedThreadId]);

  const loadDiagnostics = useCallback(async () => {
    setDiagnosticsError(null);
    try {
      const res = await apiClient.codexDiagnostics();
      setDiagnostics(res);
    } catch (err) {
      setDiagnosticsError(errorMessage(err, "Failed to load diagnostics"));
    }
  }, []);

  const loadWorkspaceRoot = useCallback(async () => {
    setWorkspaceRootError(null);
    try {
      const root = await apiClient.workspaceRootGet();
      setWorkspaceRoot(root);
    } catch (err) {
      setWorkspaceRootError(errorMessage(err, "Failed to load workspace root"));
    }
  }, []);

  const loadRecentWorkspaces = useCallback(async () => {
    try {
      const recent = await apiClient.workspaceRecentList();
      setRecentWorkspaces(recent);
    } catch {
      setRecentWorkspaces([]);
    }
  }, []);

  const listSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const res = await apiClient.codexThreadList(null, 200);
      setSessions(res.data);
    } catch (err) {
      setSessionsError(errorMessage(err, "Failed to list sessions"));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadModelsAndChatDefaults = useCallback(async () => {
    setModelsError(null);
    setStatusPopoverError(null);

    try {
      const [modelsRes, configRes] = await Promise.all([
        apiClient.codexModelList(null, 200),
        apiClient.codexConfigReadEffective(false),
      ]);

      const nextModels = (modelsRes as { data: CodexModelInfo[] }).data ?? [];
      setModels(nextModels);

      const config = (configRes as any)?.config ?? {};
      const configuredModel =
        typeof config.model === "string" ? config.model : null;
      const configuredEffort = parseReasoningEffortValue(
        config.model_reasoning_effort,
      );
      const configuredApproval = parseApprovalPolicyValue(
        config.approval_policy,
      );

      if (configuredApproval) setApprovalPolicy(configuredApproval);

      const fallbackModel =
        nextModels.find((m) => m.isDefault) ?? nextModels[0] ?? null;
      const modelToUse =
        configuredModel && nextModels.some((m) => m.model === configuredModel)
          ? configuredModel
          : (fallbackModel?.model ?? null);
      setSelectedModel(modelToUse);

      const modelInfo = modelToUse
        ? (nextModels.find((m) => m.model === modelToUse) ?? null)
        : null;
      const supportedEfforts =
        modelInfo?.supportedReasoningEfforts?.map((o) => o.reasoningEffort) ??
        [];
      const effortToUse =
        configuredEffort && supportedEfforts.includes(configuredEffort)
          ? configuredEffort
          : (modelInfo?.defaultReasoningEffort ?? null);
      setSelectedEffort(effortToUse);
    } catch (err) {
      setModelsError(errorMessage(err, "Failed to load models"));
    }
  }, []);

  const openConfig = useCallback(async () => {
    setIsConfigOpen(true);
    setConfigError(null);
    try {
      const content = await apiClient.codexReadConfig();
      setConfigText(content);
    } catch (err) {
      setConfigError(errorMessage(err, "Failed to read config"));
    }
  }, []);

  const saveConfig = useCallback(async () => {
    setConfigSaving(true);
    setConfigError(null);
    try {
      await apiClient.codexWriteConfig(configText);
    } catch (err) {
      setConfigError(errorMessage(err, "Failed to write config"));
    } finally {
      setConfigSaving(false);
    }
  }, [configText]);

  const applyApprovalPolicy = useCallback(
    async (next: ApprovalPolicy) => {
      if (next === approvalPolicy) return;
      setStatusPopoverError(null);
      const prev = approvalPolicy;
      setApprovalPolicy(next);
      setOpenStatusPopover(null);
      try {
        await apiClient.codexConfigWriteChatDefaults({ approvalPolicy: next });
      } catch (err) {
        setApprovalPolicy(prev);
        setStatusPopoverError(
          errorMessage(err, "Failed to update approval_policy"),
        );
      }
    },
    [approvalPolicy],
  );

  const applyModel = useCallback(
    async (nextModel: string) => {
      if (nextModel === selectedModel) return;
      setStatusPopoverError(null);

      const prevModel = selectedModel;
      const prevEffort = selectedEffort;

      const modelInfo = models.find((m) => m.model === nextModel) ?? null;
      const supportedEfforts =
        modelInfo?.supportedReasoningEfforts?.map((o) => o.reasoningEffort) ??
        [];
      const nextEffort =
        selectedEffort && supportedEfforts.includes(selectedEffort)
          ? selectedEffort
          : (modelInfo?.defaultReasoningEffort ?? null);

      setSelectedModel(nextModel);
      setSelectedEffort(nextEffort);
      setOpenStatusPopover(null);

      try {
        await apiClient.codexConfigWriteChatDefaults({
          model: nextModel,
          modelReasoningEffort: nextEffort,
        });
      } catch (err) {
        setSelectedModel(prevModel);
        setSelectedEffort(prevEffort);
        setStatusPopoverError(errorMessage(err, "Failed to update model"));
      }
    },
    [models, selectedEffort, selectedModel],
  );

  const applyReasoningEffort = useCallback(
    async (nextEffort: ReasoningEffort) => {
      if (nextEffort === selectedEffort) return;
      setStatusPopoverError(null);
      const prev = selectedEffort;
      setSelectedEffort(nextEffort);
      setOpenStatusPopover(null);
      try {
        await apiClient.codexConfigWriteChatDefaults({
          modelReasoningEffort: nextEffort,
        });
      } catch (err) {
        setSelectedEffort(prev);
        setStatusPopoverError(
          errorMessage(err, "Failed to update model_reasoning_effort"),
        );
      }
    },
    [selectedEffort],
  );

  const selectSession = useCallback(
    async (threadId: string) => {
      setSelectedThreadId(threadId);
      setTurnOrder([]);
      setTurnsById({});
      setThreadTokenUsage(null);
      setCollapsedActivityByTurnId({});
      setItemToTurnId({});
      itemToTurnRef.current = {};
      setCollapsedByEntryId({});
      setActiveThread(null);
      setActiveTurnId(null);
      setIsSessionsOpen(false);

      try {
        const res = await apiClient.codexThreadResume(threadId);
        const thread = normalizeThreadFromResponse(res);
        if (!thread) {
          const turnId = PENDING_TURN_ID;
          setTurnOrder([turnId]);
          setTurnsById({
            [turnId]: {
              id: turnId,
              status: "unknown",
              entries: [
                {
                  kind: "system",
                  id: "system-parse",
                  tone: "error",
                  text: "Failed to parse thread response.",
                },
              ],
            },
          });
          setCollapsedActivityByTurnId({ [turnId]: true });
          return;
        }

        setActiveThread(thread);
        const nextOrder: string[] = [];
        const nextTurns: Record<string, TurnBlock> = {};
        const nextEntryCollapse: Record<string, boolean> = {};
        const nextItemToTurn: Record<string, string> = {};
        const nextActivityCollapse: Record<string, boolean> = {};

        for (const turn of thread.turns ?? []) {
          const turnId = turn.id;
          if (!turnId) continue;
          nextOrder.push(turnId);
          nextActivityCollapse[turnId] = true;

          const turnEntries: ChatEntry[] = [];
          for (const item of turn.items ?? []) {
            const entry = entryFromThreadItem(item);
            if (!entry) continue;
            turnEntries.push(entry);
            nextItemToTurn[entry.id] = turnId;
            if (isCollapsibleEntry(entry))
              nextEntryCollapse[entry.id] = settings.defaultCollapseDetails;
          }

          nextTurns[turnId] = {
            id: turnId,
            status: parseTurnStatus(turn.status),
            entries: turnEntries,
          };
        }

        if (nextOrder.length === 0) {
          const turnId = PENDING_TURN_ID;
          nextOrder.push(turnId);
          nextActivityCollapse[turnId] = true;
          nextTurns[turnId] = { id: turnId, status: "unknown", entries: [] };
        }

        setTurnOrder(nextOrder);
        setTurnsById(nextTurns);
        setCollapsedActivityByTurnId(nextActivityCollapse);
        setCollapsedByEntryId(nextEntryCollapse);
        setItemToTurnId(nextItemToTurn);
        itemToTurnRef.current = nextItemToTurn;
      } catch (err) {
        const turnId = PENDING_TURN_ID;
        setTurnOrder([turnId]);
        setTurnsById({
          [turnId]: {
            id: turnId,
            status: "failed",
            entries: [
              {
                kind: "system",
                id: "system-error",
                tone: "error",
                text: errorMessage(err, "Failed to load thread"),
              },
            ],
          },
        });
        setCollapsedActivityByTurnId({ [turnId]: true });
      }
    },
    [settings.defaultCollapseDetails],
  );

  const createNewSession = useCallback(async () => {
    setTurnOrder([]);
    setTurnsById({});
    setThreadTokenUsage(null);
    setCollapsedActivityByTurnId({});
    setItemToTurnId({});
    itemToTurnRef.current = {};
    setCollapsedByEntryId({});
    setActiveThread(null);
    setActiveTurnId(null);
    setSelectedThreadId(null);
    try {
      const res = await apiClient.codexThreadStart(selectedModel);
      const thread = normalizeThreadFromResponse(res);
      if (thread) {
        setSelectedThreadId(thread.id);
        setActiveThread(thread);
      }
      await listSessions();
    } catch (err) {
      const turnId = PENDING_TURN_ID;
      setTurnOrder([turnId]);
      setTurnsById({
        [turnId]: {
          id: turnId,
          status: "failed",
          entries: [
            {
              kind: "system",
              id: "system-new",
              tone: "error",
              text: errorMessage(err, "Failed to start thread"),
            },
          ],
        },
      });
      setCollapsedActivityByTurnId({ [turnId]: true });
    }
  }, [listSessions, selectedModel]);

  const applyWorkspaceRoot = useCallback(
    async (nextRoot: string) => {
      setWorkspaceRootError(null);

      try {
        const root = await apiClient.workspaceRootSet(nextRoot);
        setWorkspaceRoot(root);
      } catch (err) {
        setWorkspaceRootError(errorMessage(err, "Failed to set workspace root"));
        return;
      }

      void loadRecentWorkspaces();
      setIsWorkspaceMenuOpen(false);
      await createNewSession();
    },
    [createNewSession, loadRecentWorkspaces],
  );

  const openWorkspaceDialog = useCallback(async () => {
    let selection: string | string[] | null;
    try {
      selection = await openDialog({ directory: true, multiple: false });
    } catch (err) {
      setWorkspaceRootError(
        errorMessage(err, "Directory picker is unavailable in this build"),
      );
      return;
    }
    const selectedPath = Array.isArray(selection) ? selection[0] : selection;
    if (typeof selectedPath !== "string" || selectedPath.length === 0) return;
    await applyWorkspaceRoot(selectedPath);
  }, [applyWorkspaceRoot]);

  const sendMessage = useCallback(async () => {
    const userInput = input;
    const trimmedInput = userInput.trim();
    if (!trimmedInput) return;

    setSending(true);
    try {
      let threadId = selectedThreadId;
      let currentRepoPath = activeThread?.cwd ?? null;
      if (!threadId) {
        const res = await apiClient.codexThreadStart(selectedModel);
        const thread = normalizeThreadFromResponse(res);
        if (!thread) throw new Error("Failed to start thread");
        threadId = thread.id;
        currentRepoPath = thread.cwd ?? null;
        setSelectedThreadId(threadId);
        setActiveThread(thread);
        await listSessions();
      }

      const outgoingText = autoContextEnabled
        ? wrapUserInputWithRepoContext({
            userInput,
            currentRepoPath,
            relatedRepoPaths,
          })
        : userInput;

      const userEntry: ChatEntry = {
        kind: "user",
        id: `user-${crypto.randomUUID()}`,
        text: userInput,
      };
      setTurnOrder((prev) =>
        prev.includes(PENDING_TURN_ID) ? prev : [...prev, PENDING_TURN_ID],
      );
      setCollapsedActivityByTurnId((prev) =>
        Object.prototype.hasOwnProperty.call(prev, PENDING_TURN_ID)
          ? prev
          : { ...prev, [PENDING_TURN_ID]: true },
      );
      setTurnsById((prev) => {
        const existing = prev[PENDING_TURN_ID] ?? {
          id: PENDING_TURN_ID,
          status: "inProgress" as const,
          entries: [],
        };
        return {
          ...prev,
          [PENDING_TURN_ID]: {
            ...existing,
            status: "inProgress",
            entries: [...existing.entries, userEntry],
          },
        };
      });
      setInput("");
      await apiClient.codexTurnStart(
        threadId,
        outgoingText,
        selectedModel,
        selectedEffort,
        approvalPolicy,
      );
    } catch (err) {
      const systemEntry: ChatEntry = {
        kind: "system",
        id: `system-send-${crypto.randomUUID()}`,
        tone: "error",
        text: errorMessage(err, "Failed to send"),
      };
      setTurnOrder((prev) =>
        prev.includes(PENDING_TURN_ID) ? prev : [...prev, PENDING_TURN_ID],
      );
      setCollapsedActivityByTurnId((prev) =>
        Object.prototype.hasOwnProperty.call(prev, PENDING_TURN_ID)
          ? prev
          : { ...prev, [PENDING_TURN_ID]: true },
      );
      setTurnsById((prev) => {
        const existing = prev[PENDING_TURN_ID] ?? {
          id: PENDING_TURN_ID,
          status: "failed" as const,
          entries: [],
        };
        return {
          ...prev,
          [PENDING_TURN_ID]: {
            ...existing,
            status: existing.status,
            entries: [...existing.entries, systemEntry],
          },
        };
      });
    } finally {
      setSending(false);
    }
  }, [
    approvalPolicy,
    input,
    listSessions,
    selectedEffort,
    selectedModel,
    selectedThreadId,
    autoContextEnabled,
    activeThread?.cwd,
    relatedRepoPaths,
  ]);

  const approve = useCallback(
    async (requestId: number, decision: "accept" | "decline") => {
      await apiClient.codexRespondApproval(requestId, decision);
    },
    [],
  );

  const toggleEntryCollapse = useCallback(
    (entryId: string) => {
      setCollapsedByEntryId((prev) => {
        const current = prev[entryId] ?? settings.defaultCollapseDetails;
        return { ...prev, [entryId]: !current };
      });
    },
    [settings.defaultCollapseDetails],
  );

  const toggleTurnActivity = useCallback((turnId: string) => {
    setCollapsedActivityByTurnId((prev) => ({
      ...prev,
      [turnId]: !(prev[turnId] ?? true),
    }));
  }, []);

  const toggleTurnReplies = useCallback((turnId: string) => {
    setCollapsedRepliesByTurnId((prev) => {
      const nextCollapsed = !(prev[turnId] ?? false);
      if (nextCollapsed) {
        setCollapsedActivityByTurnId((activityPrev) => ({
          ...activityPrev,
          [turnId]: true,
        }));
      }
      return { ...prev, [turnId]: nextCollapsed };
    });
  }, []);

  // Context management callbacks
  const addRelatedRepoDir = useCallback(async () => {
    if (!selectedThreadId) return;
    const currentRepoPath = activeThread?.cwd;
    if (!currentRepoPath) return;

    const selection = await openDialog({ directory: true, multiple: false });
    const selectedPath = Array.isArray(selection) ? selection[0] : selection;
    if (typeof selectedPath !== "string" || selectedPath.length === 0) return;

    setRelatedRepoPaths((prev) => {
      if (prev.length >= 3) return prev;
      if (selectedPath === currentRepoPath) return prev;
      if (prev.includes(selectedPath)) return prev;
      const next = [...prev, selectedPath];
      relatedRepoPathsByThreadIdRef.current[selectedThreadId] = next;
      return next;
    });
  }, [activeThread?.cwd, selectedThreadId]);

  const removeRelatedRepoDir = useCallback(
    (path: string) => {
      if (!selectedThreadId) return;
      setRelatedRepoPaths((prev) => {
        const next = prev.filter((p) => p !== path);
        relatedRepoPathsByThreadIdRef.current[selectedThreadId] = next;
        return next;
      });
    },
    [selectedThreadId],
  );

  const loadAutoContext = useCallback(async () => {
    if (!autoContextEnabled) {
      setAutoContext(null);
      return;
    }
    try {
      const cwd = activeThread?.cwd;
      if (!cwd) {
        setAutoContext(null);
        return;
      }
      const ctx = await apiClient.getAutoContext(cwd);
      setAutoContext(ctx);
    } catch {
      setAutoContext(null);
    }
  }, [autoContextEnabled, activeThread?.cwd]);

  const searchFiles = useCallback(
    async (query: string) => {
      setFileSearchQuery(query);
      if (!query.trim()) {
        setFileSearchResults([]);
        return;
      }
      try {
        const cwd = activeThread?.cwd ?? ".";
        const results = await apiClient.searchWorkspaceFiles(cwd, query, 8);
        setFileSearchResults(results);
      } catch {
        setFileSearchResults([]);
      }
    },
    [activeThread?.cwd],
  );

  const addFileAttachment = useCallback(
    async (file: FileInfo) => {
      try {
        const cwd = activeThread?.cwd ?? ".";
        const fullPath = file.path.startsWith("/")
          ? file.path
          : `${cwd}/${file.path}`;
        const content = await apiClient.readFileContent(fullPath);
        setFileAttachments((prev) => {
          if (prev.some((f) => f.path === file.path)) return prev;
          return [...prev, { path: file.path, name: file.name, content }];
        });
        setIsAddContextOpen(false);
        setFileSearchQuery("");
        setFileSearchResults([]);
      } catch {
        // ignore
      }
    },
    [activeThread?.cwd],
  );

  const removeFileAttachment = useCallback((path: string) => {
    setFileAttachments((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        setFileAttachments((prev) => [
          ...prev,
          { path: file.name, name: file.name, content: base64 },
        ]);
      };
      reader.readAsDataURL(file);
      setIsAddContextOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const filteredSlashCommands = useMemo(() => {
    if (!slashSearchQuery.trim()) return SLASH_COMMANDS;
    const q = slashSearchQuery.toLowerCase();
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q),
    );
  }, [slashSearchQuery]);

  const executeSlashCommand = useCallback(
    (cmdId: string) => {
      setIsSlashMenuOpen(false);
      setSlashSearchQuery("");
      setSlashHighlightIndex(0);

      switch (cmdId) {
        case "new":
          void createNewSession();
          break;
        case "clear":
          setTurnOrder([]);
          setTurnsById({});
          setCollapsedActivityByTurnId({});
          setCollapsedByEntryId({});
          break;
        case "context":
          setAutoContextEnabled((v) => !v);
          break;
        case "status": {
          const statusText = [
            `Thread: ${selectedThreadId ?? "none"}`,
            `Model: ${selectedModel ?? "default"}`,
            `Effort: ${selectedEffort ?? "default"}`,
            `Approval: ${approvalPolicy}`,
          ].join("\n");
          const entry: ChatEntry = {
            kind: "system",
            id: `system-status-${crypto.randomUUID()}`,
            tone: "info",
            text: statusText,
          };
          setTurnOrder((prev) =>
            prev.includes(PENDING_TURN_ID) ? prev : [...prev, PENDING_TURN_ID],
          );
          setTurnsById((prev) => {
            const existing = prev[PENDING_TURN_ID] ?? {
              id: PENDING_TURN_ID,
              status: "unknown" as const,
              entries: [],
            };
            return {
              ...prev,
              [PENDING_TURN_ID]: {
                ...existing,
                entries: [...existing.entries, entry],
              },
            };
          });
          break;
        }
        case "feedback":
          window.open(
            "https://github.com/anthropics/claude-code/issues",
            "_blank",
          );
          break;
        case "review":
          setInput("/review ");
          textareaRef.current?.focus();
          break;
      }
    },
    [
      approvalPolicy,
      createNewSession,
      selectedEffort,
      selectedModel,
      selectedThreadId,
    ],
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash menu navigation
      if (isSlashMenuOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashHighlightIndex((i) =>
            Math.min(i + 1, filteredSlashCommands.length - 1),
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashHighlightIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const cmd = filteredSlashCommands[slashHighlightIndex];
          if (cmd) executeSlashCommand(cmd.id);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setIsSlashMenuOpen(false);
          return;
        }
      }

      // Open slash menu when typing /
      if (e.key === "/" && input === "") {
        setIsSlashMenuOpen(true);
        setSlashHighlightIndex(0);
      }

      // Send message
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void sendMessage();
      }
    },
    [
      executeSlashCommand,
      filteredSlashCommands,
      input,
      isSlashMenuOpen,
      sendMessage,
      slashHighlightIndex,
    ],
  );

  // Load auto context when enabled or thread changes
  useEffect(() => {
    void loadAutoContext();
  }, [loadAutoContext]);

  useEffect(() => {
    listSessions();
    loadModelsAndChatDefaults();
    void loadWorkspaceRoot();
    void loadRecentWorkspaces();
  }, [listSessions, loadModelsAndChatDefaults, loadWorkspaceRoot, loadRecentWorkspaces]);

  useEffect(() => {
    let mounted = true;
    const unlistenPromise = listen<CodexJsonRpcEvent>(
      "codex_app_server",
      (event) => {
        if (!mounted) return;
        const payload = event.payload;
        if (!payload || typeof payload !== "object") return;

        if (payload.kind === "stderr") {
          return;
        }

        const message = payload.message as any;
        const method = safeString(message?.method);

        if (payload.kind === "notification") {
          const params = message?.params ?? null;
          const threadId = safeString(params?.threadId ?? params?.thread_id);
          if (selectedThreadId && threadId && threadId !== selectedThreadId)
            return;

          if (method === "thread/tokenUsage/updated") {
            const tokenUsage =
              params?.tokenUsage ?? params?.token_usage ?? null;
            const totalTokens = Number(
              tokenUsage?.total?.totalTokens ?? tokenUsage?.total?.total_tokens,
            );
            const contextWindowRaw =
              tokenUsage?.modelContextWindow ??
              tokenUsage?.model_context_window;
            const contextWindow =
              contextWindowRaw == null ? null : Number(contextWindowRaw);
            if (!Number.isFinite(totalTokens)) return;
            setThreadTokenUsage({
              totalTokens,
              contextWindow: Number.isFinite(contextWindow)
                ? contextWindow
                : null,
            });
            return;
          }

          if (method === "turn/started") {
            const turnId = safeString(params?.turn?.id ?? params?.turnId);
            if (!turnId) return;

            setActiveTurnId(turnId);
            setTurnOrder((prev) => {
              const withoutPending = prev.filter(
                (id) => id !== PENDING_TURN_ID,
              );
              if (withoutPending.includes(turnId)) return withoutPending;
              return [...withoutPending, turnId];
            });
            setCollapsedActivityByTurnId((prev) => {
              const next: Record<string, boolean> = {
                ...prev,
                [turnId]: prev[turnId] ?? true,
              };
              delete next[PENDING_TURN_ID];
              return next;
            });
            setTurnsById((prev) => {
              const pending = prev[PENDING_TURN_ID];
              const existing = prev[turnId];
              const mergedEntries = [
                ...(pending?.entries ?? []),
                ...(existing?.entries ?? []),
              ];

              const next: Record<string, TurnBlock> = {
                ...prev,
                [turnId]: {
                  id: turnId,
                  status: "inProgress",
                  entries: mergedEntries,
                },
              };
              delete next[PENDING_TURN_ID];
              return next;
            });
            return;
          }

          if (method === "turn/completed") {
            const turnId = safeString(params?.turn?.id ?? params?.turnId);
            if (!turnId) return;

            const status = parseTurnStatus(params?.turn?.status ?? "completed");
            setTurnsById((prev) => {
              const existing = prev[turnId] ?? {
                id: turnId,
                status: "unknown" as const,
                entries: [],
              };
              return { ...prev, [turnId]: { ...existing, status } };
            });
            if (activeTurnId === turnId) setActiveTurnId(null);
            return;
          }

          if (method === "item/started" || method === "item/completed") {
            const item = params?.item as CodexThreadItem | undefined;
            if (!item) return;
            const entry = entryFromThreadItem(item);
            if (!entry) return;
            const explicitTurnId = safeString(
              params?.turnId ?? params?.turn_id ?? params?.turn?.id,
            );
            const turnId = explicitTurnId || activeTurnId || PENDING_TURN_ID;

            itemToTurnRef.current = {
              ...itemToTurnRef.current,
              [entry.id]: turnId,
            };
            setItemToTurnId(itemToTurnRef.current);

            setTurnOrder((prev) =>
              prev.includes(turnId) ? prev : [...prev, turnId],
            );
            setCollapsedActivityByTurnId((prev) =>
              Object.prototype.hasOwnProperty.call(prev, turnId)
                ? prev
                : { ...prev, [turnId]: true },
            );
            setTurnsById((prev) => {
              const existing = prev[turnId] ?? {
                id: turnId,
                status: "inProgress" as const,
                entries: [],
              };
              return {
                ...prev,
                [turnId]: {
                  ...existing,
                  entries: mergeEntry(existing.entries, entry),
                },
              };
            });
            setCollapsedByEntryId((prev) => {
              if (!isCollapsibleEntry(entry)) return prev;
              if (Object.prototype.hasOwnProperty.call(prev, entry.id))
                return prev;
              return { ...prev, [entry.id]: settings.defaultCollapseDetails };
            });
            return;
          }

          if (method === "item/agentMessage/delta") {
            const itemId = safeString(params?.itemId);
            const delta = safeString(params?.delta);
            if (!itemId || !delta) return;
            const turnId =
              itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
            setTurnsById((prev) => {
              const existing = prev[turnId];
              if (!existing) return prev;
              return {
                ...prev,
                [turnId]: {
                  ...existing,
                  entries: appendDelta(
                    existing.entries,
                    itemId,
                    "message",
                    delta,
                  ),
                },
              };
            });
            return;
          }

          if (
            method === "item/reasoning/textDelta" ||
            method === "item/reasoning/summaryTextDelta"
          ) {
            const itemId = safeString(params?.itemId);
            const delta = safeString(params?.delta);
            if (!itemId || !delta) return;
            const turnId =
              itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
            setTurnsById((prev) => {
              const existing = prev[turnId];
              if (!existing) return prev;
              return {
                ...prev,
                [turnId]: {
                  ...existing,
                  entries: appendDelta(
                    existing.entries,
                    itemId,
                    "reasoning",
                    delta,
                  ),
                },
              };
            });
            return;
          }

          if (method === "item/mcpToolCall/progress") {
            const itemId = safeString(params?.itemId);
            const progress = safeString(params?.message);
            if (!itemId || !progress) return;
            const turnId =
              itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
            setTurnsById((prev) => {
              const existing = prev[turnId];
              if (!existing) return prev;
              const idx = existing.entries.findIndex(
                (e) => e.kind === "mcp" && e.id === itemId,
              );
              if (idx === -1) return prev;
              const entriesCopy = [...existing.entries];
              const e = entriesCopy[idx] as Extract<ChatEntry, { kind: "mcp" }>;
              entriesCopy[idx] = { ...e, message: progress };
              return {
                ...prev,
                [turnId]: { ...existing, entries: entriesCopy },
              };
            });
            return;
          }

          if (method === "error") {
            const errMsg = safeString(params?.error?.message);
            if (!errMsg) return;
            const turnId = activeTurnId ?? PENDING_TURN_ID;
            const entry: ChatEntry = {
              kind: "system",
              id: `system-err-${crypto.randomUUID()}`,
              tone: "error",
              text: errMsg,
            };
            setTurnOrder((prev) =>
              prev.includes(turnId) ? prev : [...prev, turnId],
            );
            setTurnsById((prev) => {
              const existing = prev[turnId] ?? {
                id: turnId,
                status: "unknown" as const,
                entries: [],
              };
              return {
                ...prev,
                [turnId]: {
                  ...existing,
                  entries: [...existing.entries, entry],
                },
              };
            });
            return;
          }
        }

        if (payload.kind === "request") {
          const params = message?.params ?? null;
          const threadId = safeString(params?.threadId);
          if (selectedThreadId && threadId && threadId !== selectedThreadId)
            return;

          const requestId = Number(message?.id);
          if (!Number.isFinite(requestId)) return;

          if (method === "item/commandExecution/requestApproval") {
            const itemId = safeString(params?.itemId);
            const reason = params?.reason ? String(params.reason) : null;
            if (!itemId) return;
            const explicitTurnId = safeString(
              params?.turnId ?? params?.turn_id,
            );
            const turnId =
              explicitTurnId ||
              itemToTurnRef.current[itemId] ||
              activeTurnId ||
              PENDING_TURN_ID;
            setTurnsById((prev) => {
              const existing = prev[turnId];
              if (!existing) return prev;
              const updated = existing.entries.map((e) => {
                if (e.kind !== "command" || e.id !== itemId) return e;
                return { ...e, approval: { requestId, reason } };
              });
              return { ...prev, [turnId]: { ...existing, entries: updated } };
            });
            return;
          }

          if (method === "item/fileChange/requestApproval") {
            const itemId = safeString(params?.itemId);
            const reason = params?.reason ? String(params.reason) : null;
            if (!itemId) return;
            const explicitTurnId = safeString(
              params?.turnId ?? params?.turn_id,
            );
            const turnId =
              explicitTurnId ||
              itemToTurnRef.current[itemId] ||
              activeTurnId ||
              PENDING_TURN_ID;
            setTurnsById((prev) => {
              const existing = prev[turnId];
              if (!existing) return prev;
              const updated = existing.entries.map((e) => {
                if (e.kind !== "fileChange" || e.id !== itemId) return e;
                return { ...e, approval: { requestId, reason } };
              });
              return { ...prev, [turnId]: { ...existing, entries: updated } };
            });
            return;
          }
        }
      },
    );

    return () => {
      mounted = false;
      unlistenPromise
        .then((unlisten) => unlisten())
        .catch(() => {
          // ignore
        });
    };
  }, [activeTurnId, selectedThreadId, settings.defaultCollapseDetails]);

  const selectedModelInfo = useMemo(() => {
    if (!selectedModel) return null;
    return models.find((m) => m.model === selectedModel) ?? null;
  }, [models, selectedModel]);

  const contextUsageLabel = useMemo(() => {
    if (!threadTokenUsage) return "—";
    const used = threadTokenUsage.totalTokens;
    const window = threadTokenUsage.contextWindow;
    if (!window || !Number.isFinite(window) || window <= 0)
      return `${formatTokenCount(used)}`;
    const pct = Math.min(999, Math.max(0, Math.round((used / window) * 100)));
    return `${pct}%`;
  }, [threadTokenUsage]);

  const effortOptions = useMemo(() => {
    return selectedModelInfo?.supportedReasoningEfforts ?? [];
  }, [selectedModelInfo]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const turnBlocks = useMemo(() => {
    const out: TurnBlock[] = [];
    for (const id of turnOrder) {
      const turn = turnsById[id];
      if (turn) out.push(turn);
    }
    return out;
  }, [turnOrder, turnsById]);

  const renderTurns = useMemo(() => {
    return turnBlocks.map((turn) => {
      const visible = settings.showReasoning
        ? turn.entries
        : turn.entries.filter(
            (e) => e.kind !== "assistant" || e.role !== "reasoning",
          );

      const chatEntries = visible.filter((e) => !isActivityEntry(e));
      const activityEntries = visible.filter(isActivityEntry);
      const userEntries = chatEntries.filter(
        (e) => e.kind === "user",
      ) as Extract<ChatEntry, { kind: "user" }>[];
      const replyEntries = chatEntries.filter((e) => e.kind !== "user");
      const assistantMessages = replyEntries.filter(
        (e): e is Extract<ChatEntry, { kind: "assistant" }> =>
          e.kind === "assistant" && e.role === "message",
      );
      const finalAssistantMessageId =
        assistantMessages.length > 0
          ? assistantMessages[assistantMessages.length - 1].id
          : null;

      return {
        id: turn.id,
        status: turn.status,
        chatEntries,
        userEntries,
        replyEntries,
        finalAssistantMessageId,
        activityEntries,
      };
    });
  }, [settings.showReasoning, turnBlocks]);

  const renderCount = useMemo(() => {
    return renderTurns.reduce((acc, t) => {
      const repliesCollapsed = collapsedRepliesByTurnId[t.id] ?? false;
      const activityCollapsed = collapsedActivityByTurnId[t.id] ?? true;

      const visibleRepliesCount = repliesCollapsed
        ? t.replyEntries.filter((e) => e.kind === "system").length +
          (t.finalAssistantMessageId ? 1 : 0)
        : t.replyEntries.length;
      const visibleActivityCount =
        !repliesCollapsed && !activityCollapsed ? t.activityEntries.length : 0;

      return acc + t.userEntries.length + visibleRepliesCount + visibleActivityCount;
    }, 0);
  }, [collapsedActivityByTurnId, collapsedRepliesByTurnId, renderTurns]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [renderCount]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[72px] shrink-0 flex-col items-center gap-4 border-r border-white/10 bg-bg-panel/40 pt-6 pb-0.5">
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 text-lg text-text-main"
          title="Codex"
        >
          ✷
        </button>

        <div className="mt-auto flex flex-col items-center gap-3">
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-bg-panelHover text-lg text-text-main hover:border-white/20"
            onClick={() => void createNewSession()}
            title="New session"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>
      </aside>

      <div className="relative flex min-h-0 flex-1 flex-col px-8 pt-6 pb-0.5">
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-xl font-semibold">Codex</div>
              <div className="text-sm text-text-dim">· AgentMesh</div>
            </div>

            <div className="mt-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-text-main transition hover:bg-bg-panelHover hover:text-primary"
                    title={activeThread?.cwd ?? workspaceRoot ?? ""}
                    onClick={() => setIsWorkspaceMenuOpen((v) => !v)}
                  >
                    <Folder className="h-4 w-4 text-text-dim" />
                    <span className="truncate">
                      {activeThread?.cwd || workspaceRoot
                        ? repoNameFromPath(
                            activeThread?.cwd ?? workspaceRoot ?? "",
                          )
                        : "Choose workspace"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-text-dim" />
                  </button>

                  {isWorkspaceMenuOpen ? (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsWorkspaceMenuOpen(false)}
                        role="button"
                        tabIndex={0}
                      />
                      <div className="absolute left-0 top-[36px] z-50 w-[320px] rounded-2xl border border-white/10 bg-bg-panel/95 p-2 shadow-xl backdrop-blur">
                        <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-dim">
                          Current project
                        </div>
                        <div className="rounded-xl border border-white/10 bg-bg-panelHover px-3 py-2">
                          <div className="flex items-center gap-2 text-sm text-text-main">
                            <Folder className="h-4 w-4 text-text-dim" />
                            <span className="truncate font-medium">
                              {repoNameFromPath(
                                activeThread?.cwd ?? workspaceRoot ?? "",
                              )}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-[11px] text-text-muted">
                            {activeThread?.cwd ?? workspaceRoot ?? "Not set"}
                          </div>
                        </div>

                        <div className="my-2 border-t border-white/10" />

                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-text-main hover:bg-bg-panelHover"
                          onClick={() => void openWorkspaceDialog()}
                        >
                          <FolderOpen className="h-4 w-4 text-text-dim" />
                          <span>Open project…</span>
                        </button>

                        {recentWorkspaces.filter(
                          (p) => p !== (activeThread?.cwd ?? workspaceRoot),
                        ).length > 0 ? (
                          <>
                            <div className="mt-2 border-t border-white/10 pt-2" />
                            <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-dim">
                              Recent projects
                            </div>
                            <div>
                              {recentWorkspaces
                                .filter(
                                  (p) =>
                                    p !== (activeThread?.cwd ?? workspaceRoot),
                                )
                                .slice(0, 5)
                                .map((path) => (
                                  <button
                                    key={path}
                                    type="button"
                                    className="w-full rounded-xl px-3 py-2 text-left hover:bg-bg-panelHover"
                                    onClick={() => void applyWorkspaceRoot(path)}
                                    title={path}
                                  >
                                    <div className="flex items-center gap-2 text-sm text-text-main">
                                      <Folder className="h-4 w-4 text-text-dim" />
                                      <span className="truncate font-medium">
                                        {repoNameFromPath(path)}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 truncate text-[11px] text-text-muted">
                                      {path}
                                    </div>
                                  </button>
                                ))}
                            </div>
                          </>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
                {selectedThreadId &&
                activeThread?.cwd &&
                relatedRepoPaths.length < 3 ? (
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-text-muted hover:text-text-main"
                    onClick={() => void addRelatedRepoDir()}
                  >
                    + add dir
                  </button>
                ) : null}
              </div>

              {activeThread?.cwd && relatedRepoPaths.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {relatedRepoPaths.map((path) => (
                    <div
                      key={path}
                      className="group inline-flex items-center rounded-full border border-white/10 bg-bg-panelHover px-2 py-0.5 text-[11px] text-text-muted"
                      title={path}
                    >
                      <span className="max-w-[140px] truncate">
                        {repoNameFromPath(path)}
                      </span>
                      <button
                        type="button"
                        className="ml-1 rounded px-1 text-status-error opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-white/5"
                        onClick={() => removeRelatedRepoDir(path)}
                        aria-label={`Remove related repo ${repoNameFromPath(path)}`}
                      >
                        -
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {workspaceRootError ? (
              <div className="mt-2 text-xs text-status-warning">
                {workspaceRootError}
              </div>
            ) : null}
          </div>

          <div className="relative flex shrink-0 items-center">
            <div className="inline-flex items-center rounded-xl border border-white/10 bg-bg-panel/40 p-1 backdrop-blur">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-sm text-text-main hover:bg-bg-panelHover"
                onClick={() => {
                  setIsSettingsMenuOpen(false);
                  setIsSessionsOpen(true);
                }}
                title="Sessions"
              >
                <Menu className="h-5 w-5" />
              </button>

              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-sm text-text-main hover:bg-bg-panelHover"
                onClick={() => setIsSettingsMenuOpen((v) => !v)}
                title="Menu"
              >
                <Settings2 className="h-5 w-5" />
              </button>

              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-sm text-text-main hover:bg-bg-panelHover"
                onClick={() => {
                  setIsSettingsMenuOpen(false);
                  void createNewSession();
                }}
                title="New session"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>

            {isSettingsMenuOpen ? (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsSettingsMenuOpen(false)}
                  role="button"
                  tabIndex={0}
                />
                <div className="absolute right-0 top-[44px] z-50 w-[220px] rounded-2xl border border-white/10 bg-bg-panel/95 p-2 shadow-xl backdrop-blur">
                  <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-dim">
                    Menu
                  </div>
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-bg-panelHover"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      void openWorkspaceDialog();
                    }}
                  >
                    Switch workspace…
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-bg-panelHover"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      setIsSettingsOpen(true);
                    }}
                  >
                    Settings
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-bg-panelHover"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      void openConfig();
                    }}
                  >
                    Edit config.toml
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-bg-panelHover"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      void createNewSession();
                    }}
                  >
                    New session
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div
          ref={scrollRef}
          className="mt-4 min-h-0 flex-1 space-y-4 overflow-auto pb-4"
        >
          {renderTurns.map((turn) => {
            const activityCollapsed =
              collapsedActivityByTurnId[turn.id] ?? true;
            const repliesCollapsed = collapsedRepliesByTurnId[turn.id] ?? false;
            const hasActivity = turn.activityEntries.length > 0;
            const replyEntries = repliesCollapsed
              ? turn.replyEntries.filter((e) => {
                  if (e.kind === "system") return true;
                  return (
                    e.kind === "assistant" &&
                    e.role === "message" &&
                    e.id === turn.finalAssistantMessageId
                  );
                })
              : turn.replyEntries;

            return (
              <div key={turn.id} className="space-y-2">
                <div className="space-y-2">
                  {turn.userEntries.map((e) => (
                    <div key={e.id} className="flex justify-end">
                      <div className="max-w-[75%] rounded-xl bg-primary/15 px-3 py-2 text-sm text-text-main">
                        <div className="whitespace-pre-wrap">{e.text}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-text-dim">
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-bg-panelHover px-3 py-1 text-[11px] hover:border-white/20"
                    onClick={() => toggleTurnReplies(turn.id)}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span className="truncate">
                        {turnStatusLabel(turn.status)}
                        {turn.id === PENDING_TURN_ID ? " (pending)" : ""}
                      </span>
                      {repliesCollapsed ? (
                        <ChevronRight className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  </button>
                  {hasActivity && !repliesCollapsed ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-full border border-white/10 bg-bg-panelHover px-2 py-0.5 text-[10px] hover:border-white/20"
                      onClick={() => toggleTurnActivity(turn.id)}
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>Activity ({turn.activityEntries.length})</span>
                        {activityCollapsed ? (
                          <ChevronRight className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </span>
                    </button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {replyEntries.map((e) => {
                    if (e.kind === "assistant") {
                      const isReasoning = e.role === "reasoning";
                      return (
                        <div
                          key={e.id}
                          className={[
                            "rounded-lg border border-white/10 px-3 py-2",
                            isReasoning
                              ? "bg-black/20 text-text-muted"
                              : "bg-bg-panel/60 text-text-main backdrop-blur",
                          ].join(" ")}
                        >
                          {isReasoning ? (
                            <div className="mb-1 text-[10px] text-text-dim">
                              Reasoning
                            </div>
                          ) : null}
                          {e.streaming ? (
                            <div className="mb-1 text-[10px] text-text-dim">
                              Streaming…
                            </div>
                          ) : null}
                          <div className="whitespace-pre-wrap text-sm">
                            {e.text}
                          </div>
                        </div>
                      );
                    }

                    if (e.kind === "system") {
                      const tone = e.tone ?? "info";
                      const color =
                        tone === "error"
                          ? "border-status-error/30 bg-status-error/10 text-status-error"
                          : tone === "warning"
                            ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
                            : "border-white/10 bg-bg-panelHover text-text-muted";

                      return (
                        <div
                          key={e.id}
                          className={`rounded-lg border px-3 py-2 text-xs ${color}`}
                        >
                          {e.text}
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>

                {!repliesCollapsed && !activityCollapsed && hasActivity ? (
                  <div className="space-y-2">
                    {turn.activityEntries.map((e) => {
                      if (e.kind === "command") {
                        const collapsed =
                          collapsedByEntryId[e.id] ??
                          settings.defaultCollapseDetails;
                        return (
                          <div
                            key={e.id}
                            className="rounded-lg border border-white/10 bg-bg-panel/70 p-3 backdrop-blur"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-xs text-text-dim">
                                  Run
                                </div>
                                <div className="mt-1 font-mono text-xs text-text-main">
                                  {e.command}
                                </div>
                                {e.cwd ? (
                                  <div className="mt-1 text-[11px] text-text-dim">
                                    cwd: {e.cwd}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <div className="text-xs text-text-muted">
                                  {e.status}
                                </div>
                                <button
                                  type="button"
                                  className="rounded-md border border-white/10 bg-bg-panelHover px-2 py-1 text-[11px] hover:border-white/20"
                                  onClick={() => toggleEntryCollapse(e.id)}
                                >
                                  {collapsed ? "Expand" : "Collapse"}
                                </button>
                              </div>
                            </div>
                            {e.approval ? (
                              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                <div className="min-w-0 text-xs text-text-muted">
                                  Approval required
                                  {e.approval.reason
                                    ? `: ${e.approval.reason}`
                                    : ""}
                                  .
                                </div>
                                <div className="flex shrink-0 gap-2">
                                  <button
                                    type="button"
                                    className="rounded-md bg-status-success/20 px-3 py-1 text-xs font-semibold text-status-success"
                                    onClick={() =>
                                      void approve(
                                        e.approval!.requestId,
                                        "accept",
                                      )
                                    }
                                  >
                                    批准
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-md bg-status-error/15 px-3 py-1 text-xs font-semibold text-status-error"
                                    onClick={() =>
                                      void approve(
                                        e.approval!.requestId,
                                        "decline",
                                      )
                                    }
                                  >
                                    拒绝
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            {!collapsed && e.output ? (
                              <pre className="mt-3 max-h-[220px] overflow-auto rounded-lg bg-black/20 p-3 text-[11px] text-text-muted">
                                {e.output}
                              </pre>
                            ) : null}
                          </div>
                        );
                      }

                      if (e.kind === "fileChange") {
                        const collapsed =
                          collapsedByEntryId[e.id] ??
                          settings.defaultCollapseDetails;
                        return (
                          <div
                            key={e.id}
                            className="rounded-lg border border-white/10 bg-bg-panel/70 p-3 backdrop-blur"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs text-text-dim">
                                  Edited
                                </div>
                                <div className="mt-0.5 text-xs text-text-muted">
                                  {e.changes.map((c) => c.path).join(", ")}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <div className="text-[10px] text-text-muted">
                                  {e.status}
                                </div>
                                <button
                                  type="button"
                                  className="rounded border border-white/10 bg-bg-panelHover px-1.5 py-0.5 text-[10px] hover:border-white/20"
                                  onClick={() => toggleEntryCollapse(e.id)}
                                >
                                  {collapsed ? "Expand" : "Collapse"}
                                </button>
                              </div>
                            </div>
                            {!collapsed ? (
                              <div className="mt-2 space-y-1.5">
                                {e.changes.map((c, idx) => (
                                  <div
                                    key={`${e.id}-${idx}`}
                                    className="rounded border border-white/10 bg-black/20 p-2"
                                  >
                                    <div className="truncate text-xs font-semibold">
                                      {c.path}
                                    </div>
                                    {c.diff ? (
                                      <pre className="mt-1.5 max-h-[180px] overflow-auto text-[10px] text-text-muted">
                                        {c.diff}
                                      </pre>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {e.approval ? (
                              <div className="mt-2 flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1.5">
                                <div className="min-w-0 text-[10px] text-text-muted">
                                  Approval required
                                  {e.approval.reason
                                    ? `: ${e.approval.reason}`
                                    : ""}
                                  .
                                </div>
                                <div className="flex shrink-0 gap-1.5">
                                  <button
                                    type="button"
                                    className="rounded bg-status-success/20 px-2 py-0.5 text-[10px] font-semibold text-status-success"
                                    onClick={() =>
                                      void approve(
                                        e.approval!.requestId,
                                        "accept",
                                      )
                                    }
                                  >
                                    批准
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded bg-status-error/15 px-2 py-0.5 text-[10px] font-semibold text-status-error"
                                    onClick={() =>
                                      void approve(
                                        e.approval!.requestId,
                                        "decline",
                                      )
                                    }
                                  >
                                    拒绝
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      if (e.kind === "webSearch") {
                        return (
                          <div
                            key={e.id}
                            className="rounded-lg border border-white/10 bg-bg-panel/70 p-2 backdrop-blur"
                          >
                            <div className="text-[10px] text-text-dim">
                              Web search
                            </div>
                            <div className="mt-1 text-xs text-text-main">
                              {e.query}
                            </div>
                          </div>
                        );
                      }

                      if (e.kind === "mcp") {
                        return (
                          <div
                            key={e.id}
                            className="rounded-lg border border-white/10 bg-bg-panel/70 p-2 backdrop-blur"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] text-text-dim">
                                MCP tool call
                              </div>
                              <div className="text-[10px] text-text-muted">
                                {e.status}
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-text-main">
                              <span className="font-mono text-[10px]">
                                {e.server}.{e.tool}
                              </span>
                            </div>
                            {e.message ? (
                              <div className="mt-1 text-[10px] text-text-muted">
                                {e.message}
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-bg-panel/70 p-2 backdrop-blur">
          {/* File attachments display */}
          {fileAttachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {fileAttachments.map((f) => (
                <div
                  key={f.path}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-bg-panelHover px-2 py-1 text-xs"
                >
                  {f.content?.startsWith("data:image") ? (
                    <Image className="h-3.5 w-3.5 text-text-dim" />
                  ) : (
                    <File className="h-3.5 w-3.5 text-text-dim" />
                  )}
                  <span className="max-w-[120px] truncate">{f.name}</span>
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-white/10"
                    onClick={() => removeFileAttachment(f.path)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mb-2 flex items-center gap-1.5">
            {/* + Add Context Button */}
            <div className="relative">
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-bg-panelHover text-text-main hover:border-white/20"
                title="Add context"
                onClick={() => setIsAddContextOpen((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>

              {isAddContextOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => {
                      setIsAddContextOpen(false);
                      setFileSearchQuery("");
                      setFileSearchResults([]);
                    }}
                    role="button"
                    tabIndex={0}
                  />
                  <div className="absolute bottom-[32px] left-0 z-50 w-[280px] rounded-xl border border-white/10 bg-bg-panel/95 p-2 shadow-xl backdrop-blur">
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-bg-panelHover px-2 py-1.5">
                      <Search className="h-4 w-4 text-text-dim" />
                      <input
                        type="text"
                        className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-dim"
                        placeholder="Search files..."
                        value={fileSearchQuery}
                        onChange={(e) => void searchFiles(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="max-h-[200px] overflow-auto">
                      {fileSearchResults.length > 0 ? (
                        fileSearchResults.map((f) => (
                          <button
                            key={f.path}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-bg-panelHover"
                            onClick={() => void addFileAttachment(f)}
                          >
                            {f.isDirectory ? (
                              <Folder className="h-4 w-4 text-text-dim" />
                            ) : (
                              <File className="h-4 w-4 text-text-dim" />
                            )}
                            <span className="truncate">{f.path}</span>
                          </button>
                        ))
                      ) : fileSearchQuery ? (
                        <div className="px-2 py-1.5 text-xs text-text-muted">
                          No files found
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 border-t border-white/10 pt-2">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-bg-panelHover"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Image className="h-4 w-4 text-text-dim" />
                        <span>Add image</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {/* / Slash Commands Button */}
            <div className="relative">
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-bg-panelHover text-text-main hover:border-white/20"
                title="Commands"
                onClick={() => setIsSlashMenuOpen((v) => !v)}
              >
                <Slash className="h-3.5 w-3.5" />
              </button>

              {isSlashMenuOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => {
                      setIsSlashMenuOpen(false);
                      setSlashSearchQuery("");
                      setSlashHighlightIndex(0);
                    }}
                    role="button"
                    tabIndex={0}
                  />
                  <div className="absolute bottom-[32px] left-0 z-50 w-[220px] rounded-xl border border-white/10 bg-bg-panel/95 p-2 shadow-xl backdrop-blur">
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-bg-panelHover px-2 py-1.5">
                      <Slash className="h-4 w-4 text-text-dim" />
                      <input
                        type="text"
                        className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-dim"
                        placeholder="Search commands..."
                        value={slashSearchQuery}
                        onChange={(e) => {
                          setSlashSearchQuery(e.target.value);
                          setSlashHighlightIndex(0);
                        }}
                        autoFocus
                      />
                    </div>
                    <div className="max-h-[200px] overflow-auto">
                      {filteredSlashCommands.map((cmd, idx) => (
                        <button
                          key={cmd.id}
                          type="button"
                          className={[
                            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm",
                            idx === slashHighlightIndex
                              ? "bg-bg-panelHover"
                              : "hover:bg-bg-panelHover",
                          ].join(" ")}
                          onClick={() => executeSlashCommand(cmd.id)}
                          onMouseEnter={() => setSlashHighlightIndex(idx)}
                        >
                          <span className="font-mono text-xs">{cmd.label}</span>
                          <span className="text-xs text-text-muted">
                            {cmd.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {/* Auto context toggle */}
            <button
              type="button"
              className={[
                "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] leading-none transition",
                autoContextEnabled
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-white/10 bg-bg-panelHover text-text-muted hover:border-white/20",
              ].join(" ")}
              onClick={() => setAutoContextEnabled((v) => !v)}
              title={
                autoContext
                  ? `cwd: ${autoContext.cwd}\nRecent: ${autoContext.recentFiles.length} files\nGit: ${autoContext.gitStatus?.branch ?? "N/A"}`
                  : "Auto context"
              }
            >
              <Paperclip className="h-3.5 w-3.5" />
              <span>Auto context</span>
              {autoContext?.gitStatus ? (
                <span className="rounded bg-white/10 px-1 py-0.5 text-[10px] leading-none">
                  {autoContext.gitStatus.branch}
                </span>
              ) : null}
            </button>
          </div>

          {/* Hidden file input for image upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />

          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="min-h-[40px] w-full resize-none rounded-xl border border-white/10 bg-bg-panelHover px-3 py-2 text-sm outline-none focus:border-border-active"
              placeholder="Ask for follow-up changes"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Close slash menu if input is cleared or doesn't start with /
                if (!e.target.value.startsWith("/")) {
                  setIsSlashMenuOpen(false);
                }
              }}
              onKeyDown={handleTextareaKeyDown}
              disabled={sending}
            />
            <button
              type="button"
              className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-xl bg-bg-panelHover text-text-main hover:border-white/20 disabled:opacity-50"
              onClick={() => void sendMessage()}
              disabled={sending || input.trim().length === 0}
              title="Send (Ctrl/Cmd+Enter)"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="-mx-8 mt-2 flex h-8 items-center justify-between gap-2 border-t border-white/10 bg-bg-panel/40 px-4 text-xs text-text-muted">
          <div className="flex min-w-0 flex-nowrap items-center gap-1">
            {/* Switch mode dropdown */}
            <div className="relative">
              <button
                type="button"
                className={statusBarItemClass(openStatusPopover === "profile")}
                onClick={() =>
                  setOpenStatusPopover((prev) =>
                    prev === "profile" ? null : "profile",
                  )
                }
                title="Switch mode"
              >
                <span className="truncate">
                  {approvalPolicy === "never"
                    ? "Agent (full access)"
                    : approvalPolicy === "untrusted"
                      ? "Agent"
                      : "Custom"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {openStatusPopover === "profile" ? (
                <div className="absolute bottom-[28px] left-0 z-50 min-w-[180px] rounded-md border border-white/10 bg-[#2a2a2a]/95 py-1.5 shadow-xl backdrop-blur">
                  <div className="px-3 py-1.5 text-[11px] text-text-dim">
                    Switch mode
                  </div>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] text-text-main hover:bg-white/5"
                    onClick={() => {
                      void applyApprovalPolicy("untrusted");
                      setOpenStatusPopover(null);
                    }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-text-dim" />
                      <span>Agent</span>
                    </span>
                    {approvalPolicy === "untrusted" ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] text-text-main hover:bg-white/5"
                    onClick={() => {
                      void applyApprovalPolicy("never");
                      setOpenStatusPopover(null);
                    }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5 text-text-dim" />
                      <span>Agent (full access)</span>
                    </span>
                    {approvalPolicy === "never" ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] text-text-main hover:bg-white/5"
                    onClick={() => {
                      void applyApprovalPolicy("on-request");
                      setOpenStatusPopover(null);
                    }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-text-dim" />
                      <span>Custom (config.toml)</span>
                    </span>
                    {approvalPolicy === "on-request" ||
                    approvalPolicy === "on-failure" ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mx-1 h-3 w-px bg-white/10" />

            <div className="relative">
              <button
                type="button"
                className={statusBarItemClass(openStatusPopover === "model")}
                onClick={() => {
                  setStatusPopoverError(null);
                  setOpenStatusPopover((prev) =>
                    prev === "model" ? null : "model",
                  );
                }}
                title="model"
              >
                <Box className="h-3 w-3 text-text-dim" />
                <span className="truncate">
                  {selectedModelInfo?.displayName ?? selectedModel ?? "model"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {openStatusPopover === "model" ? (
                <div className="absolute bottom-[28px] left-0 z-50 min-w-[160px] rounded-md bg-[#2a2a2a]/95 py-1 shadow-xl backdrop-blur">
                  <div className="px-2.5 py-1 text-[10px] text-text-dim">
                    Select model
                  </div>
                  <div className="max-h-[40vh] overflow-auto">
                    {models.length === 0 ? (
                      <div className="px-2.5 py-1 text-[11px] text-text-muted">
                        (unavailable)
                      </div>
                    ) : (
                      models.map((m) => {
                        const selected = selectedModel === m.model;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            className="flex w-full items-center justify-between px-2.5 py-1 text-left text-[11px] text-text-main hover:bg-white/5"
                            onClick={() => void applyModel(m.model)}
                          >
                            <span className="truncate">{m.displayName}</span>
                            {selected ? (
                              <Check className="ml-2 h-3 w-3 shrink-0" />
                            ) : null}
                          </button>
                        );
                      })
                    )}
                    {modelsError ? (
                      <div className="px-2.5 py-0.5 text-[10px] text-status-warning">
                        {modelsError}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                className={statusBarItemClass(
                  openStatusPopover === "approval_policy",
                )}
                onClick={() => {
                  setStatusPopoverError(null);
                  setOpenStatusPopover((prev) =>
                    prev === "approval_policy" ? null : "approval_policy",
                  );
                }}
                title="approval_policy"
              >
                <span className="truncate">{approvalPolicy}</span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {openStatusPopover === "approval_policy" ? (
                <div className="absolute bottom-[28px] left-0 z-50 min-w-[120px] rounded-md bg-[#2a2a2a]/95 py-1 shadow-xl backdrop-blur">
                  <div className="px-2.5 py-1 text-[10px] text-text-dim">
                    Approval policy
                  </div>
                  <div>
                    {(
                      [
                        "untrusted",
                        "on-request",
                        "on-failure",
                        "never",
                      ] as const
                    ).map((policy) => {
                      const selected = approvalPolicy === policy;
                      return (
                        <button
                          key={policy}
                          type="button"
                          className="flex w-full items-center justify-between px-2.5 py-1 text-left text-[11px] text-text-main hover:bg-white/5"
                          onClick={() => void applyApprovalPolicy(policy)}
                        >
                          <span>{policy}</span>
                          {selected ? (
                            <Check className="ml-2 h-3 w-3 shrink-0" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                className={statusBarItemClass(
                  openStatusPopover === "model_reasoning_effort",
                )}
                onClick={() => {
                  setStatusPopoverError(null);
                  setOpenStatusPopover((prev) =>
                    prev === "model_reasoning_effort"
                      ? null
                      : "model_reasoning_effort",
                  );
                }}
                title="model_reasoning_effort"
              >
                {selectedEffort ? (
                  reasoningEffortIcon(selectedEffort, "h-3 w-3 text-text-dim")
                ) : (
                  <Brain className="h-3 w-3 text-text-dim" />
                )}
                <span className="truncate">
                  {selectedEffort
                    ? reasoningEffortLabelEn(selectedEffort)
                    : "Default"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {openStatusPopover === "model_reasoning_effort" ? (
                <div className="absolute bottom-[28px] left-0 z-50 min-w-[120px] rounded-md bg-[#2a2a2a]/95 py-1 shadow-xl backdrop-blur">
                  <div className="px-2.5 py-1 text-[10px] text-text-dim">
                    Select reasoning
                  </div>
                  <div>
                    {effortOptions.length === 0 ? (
                      <div className="px-2.5 py-1 text-[11px] text-text-muted">
                        Default
                      </div>
                    ) : (
                      effortOptions.map((opt) => {
                        const selected = selectedEffort === opt.reasoningEffort;
                        return (
                          <button
                            key={opt.reasoningEffort}
                            type="button"
                            className="flex w-full items-center justify-between px-2.5 py-1 text-left text-[11px] text-text-main hover:bg-white/5"
                            onClick={() =>
                              void applyReasoningEffort(opt.reasoningEffort)
                            }
                            title={translateReasoningDesc(opt.description)}
                          >
                            <span className="inline-flex items-center gap-1">
                              {reasoningEffortIcon(
                                opt.reasoningEffort,
                                "h-3 w-3 text-text-dim",
                              )}
                              <span>
                                {reasoningEffortLabelEn(opt.reasoningEffort)}
                              </span>
                            </span>
                            {selected ? (
                              <Check className="ml-2 h-3 w-3 shrink-0" />
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {activeTurnId ? (
              <div className="flex items-center gap-1">
                <Loader2 className="h-4 w-4 animate-spin text-text-dim" />
                {selectedThreadId ? (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-text-muted transition hover:bg-bg-panelHover hover:text-text-main"
                    onClick={() =>
                      void apiClient.codexTurnInterrupt(
                        selectedThreadId,
                        activeTurnId,
                      )
                    }
                  >
                    Interrupt
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="shrink-0">{contextUsageLabel}</div>
          </div>
        </div>

        {openStatusPopover ? (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpenStatusPopover(null)}
            role="button"
            tabIndex={0}
          />
        ) : null}

        {statusPopoverError ? (
          <div className="mt-2 text-xs text-status-warning">
            {statusPopoverError}
          </div>
        ) : null}

        {isConfigOpen ? (
          <div className="fixed inset-0 z-50 flex">
            <div
              className="flex-1 bg-black/60"
              onClick={() => setIsConfigOpen(false)}
              role="button"
              tabIndex={0}
            />
            <div className="w-[520px] max-w-[90vw] border-l border-white/10 bg-bg-panel/95 p-6 backdrop-blur">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    ~/.codex/config.toml
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    Edit Codex configuration directly. Changes apply to future
                    turns.
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20"
                  onClick={() => setIsConfigOpen(false)}
                >
                  Close
                </button>
              </div>

              {configError ? (
                <div className="mb-3 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
                  {configError}
                </div>
              ) : null}

              <textarea
                className="h-[60vh] w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-[12px] text-text-main outline-none focus:border-border-active"
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                spellCheck={false}
              />

              <div className="mt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="rounded-md border border-white/10 bg-bg-panelHover px-4 py-2 text-sm hover:border-white/20"
                  onClick={() => setIsConfigOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                  onClick={() => void saveConfig()}
                  disabled={configSaving}
                >
                  {configSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isSessionsOpen ? (
          <div className="fixed inset-0 z-50 flex">
            <div
              className="flex-1 bg-black/60"
              onClick={() => setIsSessionsOpen(false)}
              role="button"
              tabIndex={0}
            />
            <div className="w-[420px] max-w-[92vw] border-l border-white/10 bg-bg-panel/95 p-6 backdrop-blur">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Sessions</div>
                  <div className="mt-1 text-xs text-text-muted">
                    Sorted by recently updated.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20"
                    onClick={() => void listSessions()}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20"
                    onClick={() => setIsSessionsOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>

              {sessionsError ? (
                <div className="mb-3 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
                  {sessionsError}
                </div>
              ) : null}

              <div className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-bg-panel/70 p-2">
                {sessionsLoading ? (
                  <div className="p-3 text-sm text-text-muted">
                    Loading sessions…
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="p-3 text-sm text-text-muted">
                    No sessions yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((s) => {
                      const isSelected = s.id === selectedThreadId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={[
                            "w-full rounded-xl border px-3 py-2 text-left transition",
                            isSelected
                              ? "border-primary/40 bg-primary/10"
                              : "border-white/10 bg-bg-panelHover hover:border-white/20",
                          ].join(" ")}
                          onClick={() => void selectSession(s.id)}
                        >
                          <div className="truncate text-sm font-semibold">
                            {s.id}
                          </div>
                          <div className="mt-1 truncate text-xs text-text-muted">
                            {s.preview || "—"}
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-dim">
                            <span className="truncate">{s.modelProvider}</span>
                            <span className="shrink-0">
                              {formatSessionUpdatedAtMs(s)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {isSettingsOpen ? (
          <div className="fixed inset-0 z-50 flex">
            <div
              className="flex-1 bg-black/60"
              onClick={() => setIsSettingsOpen(false)}
              role="button"
              tabIndex={0}
            />
            <div className="w-[520px] max-w-[92vw] border-l border-white/10 bg-bg-panel/95 p-6 backdrop-blur">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Chat Settings</div>
                  <div className="mt-1 text-xs text-text-muted">
                    Affects rendering only; no protocol changes.
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20"
                  onClick={() => setIsSettingsOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-bg-panelHover px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Show reasoning</div>
                    <div className="mt-1 text-xs text-text-muted">
                      Display Thought/Reasoning items in the timeline.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showReasoning}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        showReasoning: e.target.checked,
                      }))
                    }
                  />
                </label>

                <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-bg-panelHover px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      Default collapse details
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      When enabled, command output & diffs start collapsed (you
                      can always expand).
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.defaultCollapseDetails}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        defaultCollapseDetails: e.target.checked,
                      }))
                    }
                  />
                </label>

                <div className="rounded-xl border border-white/10 bg-bg-panelHover px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        Codex diagnostics
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        If you see “codex not found on PATH”, this shows the
                        PATH that the app-server spawn uses.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-white/10 bg-black/20 px-3 py-1 text-xs hover:border-white/20"
                      onClick={() => void loadDiagnostics()}
                    >
                      Refresh
                    </button>
                  </div>

                  {diagnosticsError ? (
                    <div className="mt-2 text-xs text-status-warning">
                      {diagnosticsError}
                    </div>
                  ) : null}

                  {diagnostics ? (
                    <div className="mt-3 space-y-2 text-[11px] text-text-muted">
                      <div className="truncate">
                        {diagnostics.resolvedCodexBin
                          ? `resolved codex: ${diagnostics.resolvedCodexBin}`
                          : "resolved codex: (not found)"}
                      </div>
                      <div className="truncate">
                        {diagnostics.envOverride
                          ? `AGENTMESH_CODEX_BIN: ${diagnostics.envOverride}`
                          : "AGENTMESH_CODEX_BIN: (unset)"}
                      </div>
                      <div className="truncate">
                        PATH source: {diagnostics.pathSource ?? "(unknown)"}
                        {diagnostics.shell
                          ? ` · shell: ${diagnostics.shell}`
                          : ""}
                      </div>
                      <div className="truncate">
                        env source: {diagnostics.envSource ?? "(unknown)"}
                        {typeof diagnostics.envCount === "number"
                          ? ` · vars: ${diagnostics.envCount}`
                          : ""}
                      </div>
                      <div className="break-all rounded-lg bg-black/20 p-2">
                        <div className="mb-1 text-text-dim">PATH</div>
                        {diagnostics.path}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-text-muted">
                      Tip: set{" "}
                      <span className="font-mono">AGENTMESH_CODEX_BIN</span> to
                      an absolute path (e.g.{" "}
                      <span className="font-mono">/opt/homebrew/bin/codex</span>
                      ) if launching from Finder.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default CodexChat;
