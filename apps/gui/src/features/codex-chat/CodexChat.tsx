import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { confirm as dialogConfirm, message as dialogMessage, open as openDialog } from '@tauri-apps/plugin-dialog';
import { Eye, Plus, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiClient } from '@/api/client';
import type { AttachmentItem, ChatEntry, CodexChatSettings, TurnBlockData } from './codex/types';
import type { ApprovalPolicy } from './codex/types';
import { errorMessage, formatTokenCount, fuzzyMatch, safeString } from './codex/utils';
import { SIDEBAR_EXPANDED_WIDTH_PX } from './codex/styles/menu-styles';
import { StatusBar, type StatusPopover } from './codex/StatusBar';
import { SessionTreeSidebar } from './codex/sidebar';
import { SLASH_COMMANDS, type SlashCommand } from './codex/slash-commands';
import { TurnBlock, type TurnBlockView } from './codex/TurnBlock';
import {
	PENDING_TURN_ID,
	attachmentDedupKey,
	basenameFromPath,
	buildTurnBlockViews,
	deriveTimelineFromThread,
	guessImageNameFromDataUrl,
	isImageDataUrl,
	useCodexJsonRpcEvents,
} from './model';
import { CodexChatComposer, CodexChatHeader, CodexChatWorkbenchSidebar, CodexChatWorkbenchThreadChips } from './ui';
import {
	loadCodexChatSettings,
	loadPinnedInputItems,
	loadSessionTreeWidth,
	persistCodexChatSettings,
	persistPinnedInputItems,
	persistSessionTreeWidth,
	SESSION_TREE_MAX_WIDTH_PX,
	SESSION_TREE_MIN_WIDTH_PX,
	type PinnedInputItem,
} from './lib/storage';
import {
	normalizeProfileName,
	parseApprovalPolicyValue,
	parseReasoningEffortValue,
	repoNameFromPath,
	uniqueStrings,
	wrapUserInputWithRepoContext,
} from './lib/parsing';
import type {
	AutoContextInfo,
	CodexModelInfo,
	CodexThread,
	CodexThreadItem,
	CodexThreadSummary,
	CodexThreadWatchEvent,
	CodexUserInput,
	CustomPrompt,
	FileAttachment,
	FileInfo,
	ReasoningEffort,
	SkillMetadata,
	WorktreeInfo,
} from '@/types/codex';
import type { TaskDirectoryEntry, TreeNodeData } from '@/types/sidebar';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TURN_APPEAR_ANIM_MS = 180;
const EXTERNAL_REFRESH_RECENT_MS = 2 * 60 * 1000;
const EXTERNAL_REFRESH_ARCHIVE_MS = 60 * 60 * 1000;
const EXTERNAL_REFRESH_THROTTLE_MS = 1000;

function extractProfileModels(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string');
	}
	return [];
}

function collectProfilesFromConfig(config: unknown): { profiles: string[]; models: string[]; selectedProfile: string | null } {
	if (!config || typeof config !== 'object') {
		return { profiles: [], models: [], selectedProfile: null };
	}
	const configRecord = config as Record<string, unknown>;
	const profilesRecord = configRecord.profiles;
	const profiles: string[] = [];
	const models: string[] = [];
	if (profilesRecord && typeof profilesRecord === 'object') {
		for (const [rawName, rawProfile] of Object.entries(profilesRecord as Record<string, unknown>)) {
			const name = normalizeProfileName(rawName);
			if (name) profiles.push(name);
			const profileConfig = rawProfile && typeof rawProfile === 'object' ? (rawProfile as Record<string, unknown>) : null;
			for (const model of extractProfileModels(profileConfig?.model)) {
				models.push(model);
			}
		}
	}
	const selectedProfile = typeof configRecord.profile === 'string' ? normalizeProfileName(configRecord.profile) : null;
	return { profiles, models, selectedProfile };
}

function parseProfilesFromToml(raw: string): { profiles: string[]; models: string[] } {
	const profiles: string[] = [];
	const models: string[] = [];
	let activeProfile: string | null = null;
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const sectionMatch = trimmed.match(/^\[profiles\.(.+)\]$/);
		if (sectionMatch) {
			const rawName = sectionMatch[1] ?? '';
			const name = normalizeProfileName(rawName);
			activeProfile = name || null;
			if (activeProfile) profiles.push(activeProfile);
			continue;
		}
		if (!activeProfile) continue;
		const modelMatch = trimmed.match(/^model\s*=\s*(.+)$/);
		if (!modelMatch) continue;
		const rawValue = modelMatch[1]?.trim() ?? '';
		if (!rawValue) continue;
		if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
			const inner = rawValue.slice(1, -1);
			for (const entry of inner.split(',')) {
				const cleaned = normalizeProfileName(entry.trim());
				if (cleaned) models.push(cleaned);
			}
		} else {
			const cleaned = normalizeProfileName(rawValue);
			if (cleaned) models.push(cleaned);
		}
	}
	return { profiles, models };
}

function buildFallbackModelInfo(models: string[]): CodexModelInfo[] {
	return models.map((model, index) => ({
		id: `fallback:${model}`,
		model,
		displayName: model,
		description: '',
		supportedReasoningEfforts: [],
		defaultReasoningEffort: 'none',
		isDefault: index === 0,
	}));
}

function mergeModelOptions(base: CodexModelInfo[], extraModels: string[]): CodexModelInfo[] {
	const merged: CodexModelInfo[] = [...base];
	const known = new Set(base.map((model) => model.model));
	for (const model of extraModels) {
		if (known.has(model)) continue;
		known.add(model);
		merged.push({
			id: `profile:${model}`,
			model,
			displayName: model,
			description: '',
			supportedReasoningEfforts: [],
			defaultReasoningEffort: 'none',
			isDefault: false,
		});
	}
	return merged;
}

function normalizeThreadFromResponse(res: unknown): CodexThread | null {
	if (!res || typeof res !== 'object') return null;
	const obj = res as Record<string, unknown>;
	const thread = obj.thread;
	if (!thread || typeof thread !== 'object') return null;
	return thread as CodexThread;
}

function labelForThread(summary?: CodexThreadSummary, fallback?: string): string {
	if (!summary) return fallback ?? 'unknown';
	const title = summary.title?.trim();
	if (title) return title;
	const preview = summary.preview?.trim();
	return preview ? preview : summary.id;
}

const isMarkdownFile = (path?: string | null) => Boolean(path && path.toLowerCase().endsWith('.md'));
const isHtmlFile = (path?: string | null) => {
	if (!path) return false;
	const lower = path.toLowerCase();
	return lower.endsWith('.html') || lower.endsWith('.htm');
};

function renderTextPreview(content: string, path: string): ReactNode {
	if (isMarkdownFile(path)) {
		return (
			<div className="space-y-3 text-sm text-text-main">
				<ReactMarkdown>{content}</ReactMarkdown>
			</div>
		);
	}
	if (isHtmlFile(path)) {
		return <iframe title="HTML preview" sandbox="" className="h-[560px] w-full rounded-md border border-white/10 bg-black/20" srcDoc={content} />;
	}
	return <pre className="max-h-[560px] overflow-auto rounded-md bg-black/20 p-3 text-xs text-text-muted">{content}</pre>;
}

function baseName(path: string): string {
	const normalized = path.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

type FilteredSlashCommand = {
	cmd: SlashCommand;
	indices: number[] | null;
	score: number;
};

type AgentPanelTab = {
	id: string;
	kind: 'agent';
	threadId: string;
	title: string;
};

type FilePanelTab = {
	id: string;
	kind: 'file';
	path: string;
	title: string;
	content: string | null;
	draft: string;
	dirty: boolean;
	loading: boolean;
	saving: boolean;
	showPreview: boolean;
	error: string | null;
};

type PanelTab = AgentPanelTab | FilePanelTab;

type TaskContextMenuState = {
	x: number;
	y: number;
	nodeId: string;
	threadId: string;
};

type PanelTabContextMenuState = {
	x: number;
	y: number;
	tabId: string;
};

type RenameTaskState = {
	threadId: string;
	value: string;
	error: string | null;
};

type RenameFileState = {
	tabId: string;
	fromPath: string;
	value: string;
	error: string | null;
};

export function CodexChat() {
	const [settings, setSettings] = useState<CodexChatSettings>(() => loadCodexChatSettings());
	const [sessions, setSessions] = useState<CodexThreadSummary[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(true);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [sessionsLoadedOnce, setSessionsLoadedOnce] = useState(false);
	const [runningThreadIds, setRunningThreadIds] = useState<Record<string, boolean>>({});
	const [isSessionTreeExpanded, setIsSessionTreeExpanded] = useState(true);
	const [sessionTreeExpandedNodes, setSessionTreeExpandedNodes] = useState<Set<string>>(new Set());
	const [selectedSessionTreeNodeOverride, setSelectedSessionTreeNodeOverride] = useState<string | null>(null);
	const [taskContextMenu, setTaskContextMenu] = useState<TaskContextMenuState | null>(null);
	const [panelTabContextMenu, setPanelTabContextMenu] = useState<PanelTabContextMenuState | null>(null);
	const [renameTaskDialog, setRenameTaskDialog] = useState<RenameTaskState | null>(null);
	const [renameFileDialog, setRenameFileDialog] = useState<RenameFileState | null>(null);
	type RerunDialogState = {
		entry: Extract<ChatEntry, { kind: 'user' }>;
	};
	const [rerunDialog, setRerunDialog] = useState<RerunDialogState | null>(null);
	const [sessionTreeWidthPx, setSessionTreeWidthPx] = useState(() => loadSessionTreeWidth(SIDEBAR_EXPANDED_WIDTH_PX));
	const autoRefreshTimerRef = useRef<number | null>(null);
	const autoRefreshUntilRef = useRef<number>(0);
	const listSessionsRef = useRef<() => Promise<void>>(async () => {});
	const externalRefreshInFlightRef = useRef(false);
	const externalRefreshPendingRef = useRef<{ threadId: string; updatedAtMs: number | null } | null>(null);
	const lastExternalRefreshAtRef = useRef(0);
	const threadWatchSeqRef = useRef(0);
	const archiveTaskInFlightRef = useRef<Set<string>>(new Set());
	const renameTaskInputRef = useRef<HTMLInputElement>(null);
	const renameFileInputRef = useRef<HTMLInputElement>(null);

	const [panelTabs, setPanelTabs] = useState<PanelTab[]>([]);
	const [activeMainTabId, setActiveMainTabId] = useState<string | null>(null);
	const panelTabsRef = useRef<PanelTab[]>([]);
	const activeMainTabIdRef = useRef<string | null>(null);

	const [workspaceDirEntriesByPath, setWorkspaceDirEntriesByPath] = useState<Record<string, TaskDirectoryEntry[]>>({});
	const [workspaceDirLoadingByPath, setWorkspaceDirLoadingByPath] = useState<Record<string, boolean>>({});
	const [workspaceListToast, setWorkspaceListToast] = useState<string | null>(null);
	const workspaceListToastTimerRef = useRef<number | null>(null);
	const sessionTreeExpandedNodesRef = useRef<Set<string>>(new Set());

	// Collab/workbench state (Codex thread graph derived from CollabAgentToolCall items).
	const [isWorkbenchEnabled, setIsWorkbenchEnabled] = useState(false);
	const [workbenchRootThreadId, setWorkbenchRootThreadId] = useState<string | null>(null);
	const [workbenchAutoFocus, setWorkbenchAutoFocus] = useState(true);
	const [forkParentByThreadId, setForkParentByThreadId] = useState<Record<string, string>>({});
	const [collabItemsByThreadId, setCollabItemsByThreadId] = useState<Record<string, Record<string, Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>>>>(
		{}
	);
	const [collabSeqByItemId, setCollabSeqByItemId] = useState<Record<string, number>>({});
	const collabSeqRef = useRef(0);
	const autoFocusInFlightRef = useRef(false);
	const lastAutoFocusedThreadRef = useRef<string | null>(null);

	const [models, setModels] = useState<CodexModelInfo[]>([]);
	const [modelsError, setModelsError] = useState<string | null>(null);
	const [profiles, setProfiles] = useState<string[]>([]);
	const [selectedProfile, setSelectedProfile] = useState<string | null>(null);

	const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
	const [activeThread, setActiveThread] = useState<CodexThread | null>(null);
	const [threadTokenUsage, setThreadTokenUsage] = useState<{
		totalTokens: number;
		contextWindow: number | null;
	} | null>(null);
	const [turnOrder, setTurnOrder] = useState<string[]>([]);
	const [turnsById, setTurnsById] = useState<Record<string, TurnBlockData>>({});
	const [collapsedWorkingByTurnId, setCollapsedWorkingByTurnId] = useState<Record<string, boolean>>({});
	const [_itemToTurnId, setItemToTurnId] = useState<Record<string, string>>({});
	const [collapsedByEntryId, setCollapsedByEntryId] = useState<Record<string, boolean>>({});
	const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

	const [input, setInput] = useState('');
	const [sending, setSending] = useState(false);
	// Avoid accidental double-send (e.g. double click / key repeat) before `sending` state disables the UI.
	const sendInFlightRef = useRef(false);

	const [selectedModel, setSelectedModel] = useState<string | null>(null);
	const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort | null>(null);
	const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>('untrusted');
	const [openStatusPopover, setOpenStatusPopover] = useState<StatusPopover>(null);
	const [statusPopoverError, setStatusPopoverError] = useState<string | null>(null);

	const [isConfigOpen, setIsConfigOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
	const [configText, setConfigText] = useState('');
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
	const [workspaceRootError, setWorkspaceRootError] = useState<string | null>(null);
	// If a thread's persisted cwd becomes invalid, fall back to the workspace root for file browsing.
	const [workspaceBasePathOverride, setWorkspaceBasePathOverride] = useState<string | null>(null);
	const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
	const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
	const itemToTurnRef = useRef<Record<string, string>>({});
	const relatedRepoPathsByThreadIdRef = useRef<Record<string, string[]>>({});
	const skipAutoScrollRef = useRef(false);
	const lastSelectedThreadIdRef = useRef<string | null>(null);

	// Context management state
	const [autoContext, setAutoContext] = useState<AutoContextInfo | null>(null);
	const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(null);
	const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
	const [worktreesError, setWorktreesError] = useState<string | null>(null);
	const [worktreesLoading, setWorktreesLoading] = useState(false);
	const [branches, setBranches] = useState<string[]>([]);
	const [branchesError, setBranchesError] = useState<string | null>(null);
	const [branchesLoading, setBranchesLoading] = useState(false);
	const [isWorktreeMenuOpen, setIsWorktreeMenuOpen] = useState(false);
	const [newWorktreeName, setNewWorktreeName] = useState('');
	const [newWorktreeBranch, setNewWorktreeBranch] = useState<string | null>(null);
	const [worktreeActionError, setWorktreeActionError] = useState<string | null>(null);
	const [worktreeCreating, setWorktreeCreating] = useState(false);
	const [relatedRepoPaths, setRelatedRepoPaths] = useState<string[]>([]);
	const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
	const [isAddContextOpen, setIsAddContextOpen] = useState(false);
	const [fileSearchQuery, setFileSearchQuery] = useState('');
	const [fileSearchResults, setFileSearchResults] = useState<FileInfo[]>([]);
	const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
	const [slashSearchQuery, setSlashSearchQuery] = useState('');
	const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);
	// Skills state
	const [skills, setSkills] = useState<SkillMetadata[]>([]);
	const [isSkillMenuOpen, setIsSkillMenuOpen] = useState(false);
	const [skillSearchQuery, setSkillSearchQuery] = useState('');
	const [skillHighlightIndex, setSkillHighlightIndex] = useState(0);
	const [selectedSkill, setSelectedSkill] = useState<SkillMetadata | null>(null);
	// Prompts state
	const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
	const [selectedPrompt, setSelectedPrompt] = useState<CustomPrompt | null>(null);
	// Slash menu pins (skill/prompt only)
	const [pinnedInputItems, setPinnedInputItems] = useState<PinnedInputItem[]>(() => loadPinnedInputItems());
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const menuListRef = useRef<HTMLDivElement>(null);
	const effectiveCwd = activeWorktreePath ?? activeThread?.cwd ?? workspaceRoot ?? null;
	const computedWorkspaceBasePath = effectiveCwd;
	const workspaceBasePath = workspaceBasePathOverride ?? computedWorkspaceBasePath;

	// Reset the override when the source base path changes (e.g. switching sessions / selecting a new project).
	useEffect(() => {
		setWorkspaceBasePathOverride(null);
	}, [computedWorkspaceBasePath]);

	useEffect(() => {
		if (selectedThreadId && selectedThreadId !== lastSelectedThreadIdRef.current) {
			lastSelectedThreadIdRef.current = selectedThreadId;
			setActiveWorktreePath(activeThread?.cwd ?? workspaceRoot ?? null);
			return;
		}
		if (!selectedThreadId && !activeWorktreePath && workspaceRoot) {
			setActiveWorktreePath(workspaceRoot);
		}
	}, [activeThread?.cwd, activeWorktreePath, selectedThreadId, workspaceRoot]);

	useEffect(() => {
		persistPinnedInputItems(pinnedInputItems);
	}, [pinnedInputItems]);

	const adjustTextareaHeight = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 264)}px`;
	}, []);

	const pinnedPromptNames = useMemo(() => {
		return new Set(pinnedInputItems.filter((item) => item.type === 'prompt').map((item) => item.name));
	}, [pinnedInputItems]);

	const pinnedSkillNames = useMemo(() => {
		return new Set(pinnedInputItems.filter((item) => item.type === 'skill').map((item) => item.name));
	}, [pinnedInputItems]);

	const togglePinnedPromptName = useCallback((promptName: string) => {
		setPinnedInputItems((prev) => {
			const idx = prev.findIndex((item) => item.type === 'prompt' && item.name === promptName);
			if (idx >= 0) return prev.filter((_, i) => i !== idx);
			return [{ type: 'prompt', name: promptName }, ...prev];
		});
	}, []);

	const togglePinnedSkillName = useCallback((skillName: string) => {
		setPinnedInputItems((prev) => {
			const idx = prev.findIndex((item) => item.type === 'skill' && item.name === skillName);
			if (idx >= 0) return prev.filter((_, i) => i !== idx);
			return [{ type: 'skill', name: skillName }, ...prev];
		});
	}, []);

	const pinnedResolvedItems = useMemo(() => {
		const out: Array<{ type: 'prompt'; prompt: CustomPrompt } | { type: 'skill'; skill: SkillMetadata }> = [];
		for (const item of pinnedInputItems) {
			if (item.type === 'prompt') {
				const prompt = prompts.find((p) => p.name === item.name);
				if (prompt) out.push({ type: 'prompt', prompt });
				continue;
			}
			if (item.type === 'skill') {
				const skill = skills.find((s) => s.name === item.name);
				if (skill) out.push({ type: 'skill', skill });
			}
		}
		return out;
	}, [pinnedInputItems, prompts, skills]);

	const normalizePath = useCallback((value: string) => value.replace(/\\/g, '/').replace(/\/+$/, ''), []);

	const activeWorktreeInfo = useMemo(() => {
		if (!activeWorktreePath) return null;
		const target = normalizePath(activeWorktreePath);
		return worktrees.find((wt) => normalizePath(wt.path) === target) ?? null;
	}, [activeWorktreePath, normalizePath, worktrees]);

	const activeWorktreeBranch = activeWorktreeInfo?.branch ?? autoContext?.gitStatus?.branch ?? null;
	const activeWorktreeLabel = useMemo(() => {
		if (!activeWorktreePath) return 'Worktree';
		const name = repoNameFromPath(activeWorktreePath);
		const branchLabel = activeWorktreeBranch ?? 'detached';
		return `${name} · ${branchLabel}`;
	}, [activeWorktreeBranch, activeWorktreePath]);

	useLayoutEffect(() => {
		adjustTextareaHeight();
	}, [adjustTextareaHeight, input]);

	const showWorkspaceListToast = useCallback((message: string) => {
		setWorkspaceListToast(message);
		if (workspaceListToastTimerRef.current) {
			window.clearTimeout(workspaceListToastTimerRef.current);
		}
		workspaceListToastTimerRef.current = window.setTimeout(() => {
			setWorkspaceListToast(null);
			workspaceListToastTimerRef.current = null;
		}, 5000);
	}, []);

	useEffect(() => {
		return () => {
			if (!workspaceListToastTimerRef.current) return;
			window.clearTimeout(workspaceListToastTimerRef.current);
			workspaceListToastTimerRef.current = null;
		};
	}, []);

	useEffect(() => {
		panelTabsRef.current = panelTabs;
	}, [panelTabs]);

	// Keep agent tab titles in sync with the latest session summaries (e.g. after renames).
	useEffect(() => {
		setPanelTabs((prev) => {
			let changed = false;
			const next = prev.map((tab) => {
				if (tab.kind !== 'agent') return tab;
				const nextTitle = labelForThread(
					sessions.find((s) => s.id === tab.threadId),
					tab.threadId
				);
				if (tab.title === nextTitle) return tab;
				changed = true;
				return { ...tab, title: nextTitle };
			});
			return changed ? next : prev;
		});
	}, [sessions]);

	useEffect(() => {
		activeMainTabIdRef.current = activeMainTabId;
	}, [activeMainTabId]);

	useEffect(() => {
		sessionTreeExpandedNodesRef.current = sessionTreeExpandedNodes;
	}, [sessionTreeExpandedNodes]);

	// Load skills on mount
	const loadSkills = useCallback(async () => {
		try {
			const res = await apiClient.codexSkillList();
			setSkills(res.skills);
		} catch {
			setSkills([]);
		}
	}, []);

	// Load prompts on mount
	const loadPrompts = useCallback(async () => {
		try {
			const res = await apiClient.codexPromptList();
			setPrompts(res.prompts);
		} catch {
			setPrompts([]);
		}
	}, []);

	const loadWorkspaceDirectory = useCallback(
		async (relativePath: string) => {
			if (!workspaceBasePath) return;
			setWorkspaceDirLoadingByPath((prev) => ({ ...prev, [relativePath]: true }));
			try {
				const entries = await apiClient.workspaceListDirectory(workspaceBasePath, relativePath);
				setWorkspaceDirEntriesByPath((prev) => ({ ...prev, [relativePath]: entries }));
			} catch (err) {
				const message = errorMessage(err, 'Failed to list directory');
				const target = relativePath.trim() ? `${workspaceBasePath.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}` : workspaceBasePath;
				setWorkspaceDirEntriesByPath((prev) => ({ ...prev, [relativePath]: [] }));

				// When the current thread's cwd goes stale (deleted/moved), keep the UI usable by
				// falling back to the workspace root for browsing.
				if (!relativePath.trim() && workspaceRoot && workspaceBasePath !== workspaceRoot) {
					setWorkspaceBasePathOverride(workspaceRoot);
					showWorkspaceListToast(`无法列出目录：${workspaceBasePath}\n${message}\n已回退到：${workspaceRoot}`);
				} else {
					showWorkspaceListToast(`无法列出目录：${target}\n${message}`);
				}
			} finally {
				setWorkspaceDirLoadingByPath((prev) => ({ ...prev, [relativePath]: false }));
			}
		},
		[showWorkspaceListToast, workspaceBasePath, workspaceRoot]
	);

	const ensureWorkspaceDirectoryLoaded = useCallback(
		(relativePath: string) => {
			if (!workspaceBasePath) return;
			if (workspaceDirEntriesByPath[relativePath] || workspaceDirLoadingByPath[relativePath]) return;
			void loadWorkspaceDirectory(relativePath);
		},
		[loadWorkspaceDirectory, workspaceBasePath, workspaceDirEntriesByPath, workspaceDirLoadingByPath]
	);

	useEffect(() => {
		persistCodexChatSettings(settings);
	}, [settings]);

	useEffect(() => {
		setWorkspaceDirEntriesByPath({});
		setWorkspaceDirLoadingByPath({});
		if (!workspaceBasePath) return;
		void loadWorkspaceDirectory('');
	}, [workspaceBasePath, loadWorkspaceDirectory]);

	useEffect(() => {
		if (!activeMainTabId) return;
		if (panelTabs.some((tab) => tab.id === activeMainTabId)) return;
		// Fallback: focus the most recently opened tab (end of array).
		setActiveMainTabId(panelTabs[panelTabs.length - 1]?.id ?? null);
	}, [activeMainTabId, panelTabs]);

	useEffect(() => {
		if (!selectedThreadId) {
			setRelatedRepoPaths([]);
			return;
		}
		setRelatedRepoPaths(relatedRepoPathsByThreadIdRef.current[selectedThreadId] ?? []);
	}, [selectedThreadId]);

	const loadDiagnostics = useCallback(async () => {
		setDiagnosticsError(null);
		try {
			const res = await apiClient.codexDiagnostics();
			setDiagnostics(res);
		} catch (err) {
			setDiagnosticsError(errorMessage(err, 'Failed to load diagnostics'));
		}
	}, []);

	const loadWorkspaceRoot = useCallback(async () => {
		setWorkspaceRootError(null);
		try {
			const root = await apiClient.workspaceRootGet();
			setWorkspaceRoot(root);
		} catch (err) {
			setWorkspaceRootError(errorMessage(err, 'Failed to load workspace root'));
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

	const loadWorktrees = useCallback(
		async (cwdOverride?: string | null) => {
			const cwd = cwdOverride ?? effectiveCwd;
			if (!cwd) {
				setWorktrees([]);
				return;
			}
			setWorktreesLoading(true);
			setWorktreesError(null);
			try {
				const list = await apiClient.gitWorktreeList(cwd);
				setWorktrees(list);
			} catch (err) {
				setWorktreesError(errorMessage(err, 'Failed to load worktrees'));
				setWorktrees([]);
			} finally {
				setWorktreesLoading(false);
			}
		},
		[effectiveCwd]
	);

	const loadBranches = useCallback(
		async (cwdOverride?: string | null) => {
			const cwd = cwdOverride ?? effectiveCwd;
			if (!cwd) {
				setBranches([]);
				return;
			}
			setBranchesLoading(true);
			setBranchesError(null);
			try {
				const list = await apiClient.gitBranchList(cwd);
				setBranches(list);
				if (!newWorktreeBranch) {
					const fallback = autoContext?.gitStatus?.branch ?? list[0] ?? null;
					setNewWorktreeBranch(fallback);
				}
			} catch (err) {
				setBranchesError(errorMessage(err, 'Failed to load branches'));
				setBranches([]);
			} finally {
				setBranchesLoading(false);
			}
		},
		[autoContext?.gitStatus?.branch, effectiveCwd, newWorktreeBranch]
	);

	const seedRunningThreads = useCallback(async () => {
		try {
			const res = await apiClient.codexThreadLoadedList(null, 200);
			setRunningThreadIds((prev) => {
				const next = { ...prev };
				for (const threadId of res.data ?? []) {
					next[threadId] = true;
				}
				return next;
			});
		} catch {
			// Ignore seed failures; running state still updates from notifications.
		}
	}, []);

	const setThreadRunning = useCallback((threadId: string, running: boolean) => {
		setRunningThreadIds((prev) => {
			if (running) {
				if (prev[threadId]) return prev;
				return { ...prev, [threadId]: true };
			}
			if (!prev[threadId]) return prev;
			const next = { ...prev };
			delete next[threadId];
			return next;
		});
	}, []);

	const maybeStartAutoRefresh = useCallback((data: CodexThreadSummary[]) => {
		const now = Date.now();
		const hasRecent = data.some((session) => session.updatedAtMs != null && now - session.updatedAtMs <= 30 * 1000);
		if (!hasRecent) return;

		autoRefreshUntilRef.current = Math.max(autoRefreshUntilRef.current, now + 30 * 1000);
		if (autoRefreshTimerRef.current != null) return;

		autoRefreshTimerRef.current = window.setInterval(() => {
			const now = Date.now();
			if (now > autoRefreshUntilRef.current) {
				if (autoRefreshTimerRef.current != null) {
					window.clearInterval(autoRefreshTimerRef.current);
					autoRefreshTimerRef.current = null;
				}
				return;
			}
			void listSessionsRef.current();
		}, 7_000);
	}, []);

	const handleSessionTreeWidthChange = useCallback((nextWidth: number) => {
		const clamped = Math.min(SESSION_TREE_MAX_WIDTH_PX, Math.max(SESSION_TREE_MIN_WIDTH_PX, nextWidth));
		setSessionTreeWidthPx(clamped);
		persistSessionTreeWidth(clamped);
	}, []);

	const listSessions = useCallback(async () => {
		const shouldShowLoading = !sessionsLoadedOnce;
		if (shouldShowLoading) {
			setSessionsLoading(true);
		}
		setSessionsError(null);
		try {
			const res = await apiClient.codexThreadList(null, 200);
			setSessions(res.data);
			setSessionsLoadedOnce(true);
			maybeStartAutoRefresh(res.data ?? []);
		} catch (err) {
			setSessionsError(errorMessage(err, 'Failed to list sessions'));
		} finally {
			if (shouldShowLoading) {
				setSessionsLoading(false);
			}
		}
	}, [maybeStartAutoRefresh, sessionsLoadedOnce]);

	useEffect(() => {
		listSessionsRef.current = listSessions;
	}, [listSessions]);

	useEffect(() => {
		return () => {
			if (autoRefreshTimerRef.current != null) {
				window.clearInterval(autoRefreshTimerRef.current);
				autoRefreshTimerRef.current = null;
			}
		};
	}, []);

	const loadModelsAndChatDefaults = useCallback(async () => {
		setModelsError(null);
		setStatusPopoverError(null);

		try {
			const [modelsRes, configRes] = await Promise.all([apiClient.codexModelList(null, 200), apiClient.codexConfigReadEffective(false)]);

			const config = (configRes as any)?.config ?? {};
			const { profiles: configProfiles, models: configProfileModels, selectedProfile: configSelectedProfile } = collectProfilesFromConfig(config);
			let rawProfiles = configProfiles;
			let rawProfileModels = configProfileModels;
			if (rawProfiles.length === 0) {
				try {
					const rawConfig = await apiClient.codexReadConfig();
					const parsed = parseProfilesFromToml(rawConfig);
					rawProfiles = parsed.profiles;
					rawProfileModels = parsed.models;
				} catch {
					// Ignore raw parse failures.
				}
			}
			const uniqueProfiles = uniqueStrings(rawProfiles);
			const profileModels = uniqueStrings(rawProfileModels);
			setProfiles(uniqueProfiles);
			const normalizedSelectedProfile = configSelectedProfile && uniqueProfiles.includes(configSelectedProfile) ? configSelectedProfile : null;
			setSelectedProfile(normalizedSelectedProfile);

			let nextModels = (modelsRes as { data: CodexModelInfo[] }).data ?? [];
			nextModels = mergeModelOptions(nextModels, profileModels);
			if (nextModels.length === 0) {
				nextModels = buildFallbackModelInfo(['gpt-5.2', 'gpt-5.2-codex']);
			}
			setModels(nextModels);

			// Read from the selected profile if one is active, otherwise use top-level config
			const profileConfig = config.profile && config.profiles?.[config.profile] ? config.profiles[config.profile] : {};
			const configuredModel = typeof profileConfig.model === 'string' ? profileConfig.model : typeof config.model === 'string' ? config.model : null;
			const configuredEffort = parseReasoningEffortValue(profileConfig.model_reasoning_effort ?? config.model_reasoning_effort);
			const configuredApproval = parseApprovalPolicyValue(profileConfig.approval_policy ?? config.approval_policy);

			if (configuredApproval) setApprovalPolicy(configuredApproval);

			const fallbackModel = nextModels.find((m) => m.isDefault) ?? nextModels[0] ?? null;
			const modelToUse = configuredModel && nextModels.some((m) => m.model === configuredModel) ? configuredModel : (fallbackModel?.model ?? null);
			setSelectedModel(modelToUse);

			const modelInfo = modelToUse ? (nextModels.find((m) => m.model === modelToUse) ?? null) : null;
			const supportedEfforts = modelInfo?.supportedReasoningEfforts?.map((o) => o.reasoningEffort) ?? [];
			const effortToUse = configuredEffort && supportedEfforts.includes(configuredEffort) ? configuredEffort : (modelInfo?.defaultReasoningEffort ?? null);
			setSelectedEffort(effortToUse);
		} catch (err) {
			setModelsError(errorMessage(err, 'Failed to load models'));
		}
	}, []);

	const openConfig = useCallback(async () => {
		setIsConfigOpen(true);
		setConfigError(null);
		try {
			const content = await apiClient.codexReadConfig();
			setConfigText(content);
		} catch (err) {
			setConfigError(errorMessage(err, 'Failed to read config'));
		}
	}, []);

	const saveConfig = useCallback(async () => {
		setConfigSaving(true);
		setConfigError(null);
		try {
			await apiClient.codexWriteConfig(configText);
		} catch (err) {
			setConfigError(errorMessage(err, 'Failed to write config'));
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
				await apiClient.codexConfigWriteChatDefaults({ approvalPolicy: next, profile: selectedProfile });
			} catch (err) {
				setApprovalPolicy(prev);
				setStatusPopoverError(errorMessage(err, 'Failed to update approval_policy'));
			}
		},
		[approvalPolicy, selectedProfile]
	);

	const applyModel = useCallback(
		async (nextModel: string) => {
			if (nextModel === selectedModel) return;
			setStatusPopoverError(null);

			const prevModel = selectedModel;
			const prevEffort = selectedEffort;

			const modelInfo = models.find((m) => m.model === nextModel) ?? null;
			const supportedEfforts = modelInfo?.supportedReasoningEfforts?.map((o) => o.reasoningEffort) ?? [];
			const nextEffort = selectedEffort && supportedEfforts.includes(selectedEffort) ? selectedEffort : (modelInfo?.defaultReasoningEffort ?? null);

			setSelectedModel(nextModel);
			setSelectedEffort(nextEffort);
			setOpenStatusPopover(null);

			try {
				await apiClient.codexConfigWriteChatDefaults({
					model: nextModel,
					modelReasoningEffort: nextEffort,
					profile: selectedProfile,
				});
			} catch (err) {
				setSelectedModel(prevModel);
				setSelectedEffort(prevEffort);
				setStatusPopoverError(errorMessage(err, 'Failed to update model'));
			}
		},
		[models, selectedEffort, selectedModel, selectedProfile]
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
					profile: selectedProfile,
				});
			} catch (err) {
				setSelectedEffort(prev);
				setStatusPopoverError(errorMessage(err, 'Failed to update model_reasoning_effort'));
			}
		},
		[selectedEffort, selectedProfile]
	);

	const ingestCollabItems = useCallback((threadId: string, items: Array<Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>>) => {
		if (!threadId || items.length === 0) return;

		setCollabItemsByThreadId((prev) => {
			const existing = prev[threadId] ?? {};
			let changed = false;
			const nextForThread: Record<string, Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>> = { ...existing };
			for (const item of items) {
				if (!item?.id) continue;
				const prevItem = nextForThread[item.id];
				if (prevItem !== item) {
					nextForThread[item.id] = item;
					changed = true;
				}
			}
			if (!changed) return prev;
			return { ...prev, [threadId]: nextForThread };
		});

		setCollabSeqByItemId((prev) => {
			let next: Record<string, number> | null = null;
			for (const item of items) {
				if (!item?.id) continue;
				if (Object.prototype.hasOwnProperty.call(prev, item.id)) continue;
				if (!next) next = { ...prev };
				next[item.id] = collabSeqRef.current++;
			}
			return next ?? prev;
		});
	}, []);

	const selectSession = useCallback(
		async (threadId: string, options?: { setAsWorkbenchRoot?: boolean }) => {
			setSelectedThreadId(threadId);
			setTurnOrder([]);
			setTurnsById({});
			setThreadTokenUsage(null);
			setCollapsedWorkingByTurnId({});
			setCollapsedByEntryId({});
			setItemToTurnId({});
			itemToTurnRef.current = {};
			setActiveThread(null);
			setActiveTurnId(null);
			if (options?.setAsWorkbenchRoot) {
				setWorkbenchRootThreadId(threadId);
			}

			try {
				const res = await apiClient.codexThreadResume(threadId);
				const thread = normalizeThreadFromResponse(res);
				if (!thread) {
					const turnId = PENDING_TURN_ID;
					setTurnOrder([turnId]);
					setTurnsById({
						[turnId]: {
							id: turnId,
							status: 'unknown',
							entries: [
								{
									kind: 'system',
									id: 'system-parse',
									tone: 'error',
									text: 'Failed to parse thread response.',
								},
							],
						},
					});
					return;
				}

				setActiveThread(thread);

				// Capture collab tool calls from this thread so the workbench tree/panel can update even
				// when the thread isn't currently focused.
				const collabItems: Array<Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>> = [];
				for (const turn of thread.turns ?? []) {
					for (const item of turn.items ?? []) {
						const rawType = safeString((item as unknown as { type?: unknown })?.type);
						const typeKey = rawType.replace(/[-_]/g, '').toLowerCase();
						if (typeKey === 'collabagenttoolcall') {
							collabItems.push(item as Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>);
						}
					}
				}
				ingestCollabItems(thread.id, collabItems);
				const timeline = deriveTimelineFromThread(thread, {
					defaultCollapseDetails: settings.defaultCollapseDetails,
				});

				setTurnOrder(timeline.order);
				setTurnsById(timeline.turnsById);
				setCollapsedByEntryId(timeline.collapsedByEntryId);
				setItemToTurnId(timeline.itemToTurnId);
				itemToTurnRef.current = timeline.itemToTurnId;
			} catch (err) {
				const turnId = PENDING_TURN_ID;
				setTurnOrder([turnId]);
				setTurnsById({
					[turnId]: {
						id: turnId,
						status: 'failed',
						entries: [
							{
								kind: 'system',
								id: 'system-error',
								tone: 'error',
								text: errorMessage(err, 'Failed to load thread'),
							},
						],
					},
				});
			}
		},
		[ingestCollabItems, settings.defaultCollapseDetails]
	);

	const resolveExternalUpdatedAtMs = useCallback(
		(threadId: string, updatedAtMs?: number | null) => {
			if (updatedAtMs != null && Number.isFinite(updatedAtMs)) return updatedAtMs;
			const summary = sessions.find((session) => session.id === threadId);
			return summary?.updatedAtMs ?? null;
		},
		[sessions]
	);

	const shouldApplyExternalRefresh = useCallback(
		(threadId: string, updatedAtMs?: number | null, allowStale?: boolean) => {
			if (!threadId || threadId !== selectedThreadId) {
				return { ok: false, updatedAtMs: null as number | null };
			}
			const resolved = resolveExternalUpdatedAtMs(threadId, updatedAtMs);
			if (resolved == null) return { ok: false, updatedAtMs: null as number | null };
			const ageMs = Date.now() - resolved;
			if (!allowStale && ageMs > EXTERNAL_REFRESH_RECENT_MS) {
				return { ok: false, updatedAtMs: resolved };
			}
			if (ageMs > EXTERNAL_REFRESH_ARCHIVE_MS) {
				return { ok: false, updatedAtMs: resolved };
			}
			return { ok: true, updatedAtMs: resolved };
		},
		[resolveExternalUpdatedAtMs, selectedThreadId]
	);

	const refreshSelectedThread = useCallback(
		async (threadId: string, updatedAtMs?: number | null, options?: { allowStale?: boolean }) => {
			if (!threadId || threadId !== selectedThreadId) return;
			if (externalRefreshInFlightRef.current) return;
			const now = Date.now();
			if (now - lastExternalRefreshAtRef.current < EXTERNAL_REFRESH_THROTTLE_MS) return;

			const { ok, updatedAtMs: resolved } = shouldApplyExternalRefresh(threadId, updatedAtMs, options?.allowStale);
			if (!ok || resolved == null) return;

			externalRefreshInFlightRef.current = true;
			lastExternalRefreshAtRef.current = now;
			try {
				const res = await apiClient.codexThreadResume(threadId);
				const thread = normalizeThreadFromResponse(res);
				if (!thread || thread.id !== threadId) return;
				if (selectedThreadId !== threadId) return;

				setActiveThread(thread);
				const collabItems: Array<Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>> = [];
				for (const turn of thread.turns ?? []) {
					for (const item of turn.items ?? []) {
						const rawType = safeString((item as unknown as { type?: unknown })?.type);
						const typeKey = rawType.replace(/[-_]/g, '').toLowerCase();
						if (typeKey === 'collabagenttoolcall') {
							collabItems.push(item as Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>);
						}
					}
				}
				ingestCollabItems(thread.id, collabItems);

				const timeline = deriveTimelineFromThread(thread, {
					defaultCollapseDetails: settings.defaultCollapseDetails,
				});
				setTurnOrder(timeline.order);
				setTurnsById(timeline.turnsById);
				setItemToTurnId(timeline.itemToTurnId);
				itemToTurnRef.current = timeline.itemToTurnId;
				setCollapsedByEntryId((prev) => {
					const next: Record<string, boolean> = { ...timeline.collapsedByEntryId };
					for (const [entryId, collapsed] of Object.entries(prev)) {
						if (Object.prototype.hasOwnProperty.call(next, entryId)) {
							next[entryId] = collapsed;
						}
					}
					return next;
				});
				setCollapsedWorkingByTurnId((prev) => {
					const next = { ...prev };
					for (const id of Object.keys(next)) {
						if (!timeline.turnsById[id]) {
							delete next[id];
						}
					}
					return next;
				});
				void listSessionsRef.current();
			} catch {
				// Best-effort; ignore refresh failures.
			} finally {
				externalRefreshInFlightRef.current = false;
			}
		},
		[ingestCollabItems, selectedThreadId, settings.defaultCollapseDetails, shouldApplyExternalRefresh]
	);

	const workbenchGraph = useMemo(() => {
		type Edge = { from: string; to: string; kind: 'spawn' | 'fork'; seq: number };

		const edges: Edge[] = [];
		const incomingCount: Record<string, number> = {};

		for (const byId of Object.values(collabItemsByThreadId)) {
			for (const item of Object.values(byId)) {
				if (!item || item.tool !== 'spawnAgent') continue;
				const from = item.senderThreadId;
				const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : [];
				if (!from || receivers.length === 0) continue;
				const seq = collabSeqByItemId[item.id] ?? Number.MAX_SAFE_INTEGER;
				for (const to of receivers) {
					if (!to) continue;
					edges.push({ from, to, kind: 'spawn', seq });
					incomingCount[to] = (incomingCount[to] ?? 0) + 1;
				}
			}
		}

		for (const [child, parent] of Object.entries(forkParentByThreadId)) {
			if (!child || !parent) continue;
			edges.push({ from: parent, to: child, kind: 'fork', seq: Number.MAX_SAFE_INTEGER });
			incomingCount[child] = (incomingCount[child] ?? 0) + 1;
		}

		const allThreads = new Set<string>();
		for (const e of edges) {
			allThreads.add(e.from);
			allThreads.add(e.to);
		}

		const rootCandidates = Array.from(allThreads).filter((t) => (incomingCount[t] ?? 0) === 0);
		rootCandidates.sort((a, b) => a.localeCompare(b));

		const rootThreadId = workbenchRootThreadId ?? selectedThreadId ?? rootCandidates[0] ?? null;

		const firstSpawnFromRoot = edges.filter((e) => e.kind === 'spawn' && e.from === rootThreadId).sort((a, b) => a.seq - b.seq)[0];
		const orchestratorThreadId = firstSpawnFromRoot?.to ?? null;

		const workerThreadIds = Array.from(
			new Set(
				edges
					.filter((e) => e.kind === 'spawn' && e.from === orchestratorThreadId)
					.sort((a, b) => a.seq - b.seq)
					.map((e) => e.to)
			)
		);

		const childrenByParent: Record<string, Array<{ threadId: string; kind: 'spawn' | 'fork'; seq: number }>> = {};
		for (const e of edges) {
			if (!childrenByParent[e.from]) childrenByParent[e.from] = [];
			childrenByParent[e.from].push({ threadId: e.to, kind: e.kind, seq: e.seq });
		}
		for (const list of Object.values(childrenByParent)) {
			list.sort((a, b) => (a.kind === b.kind ? a.seq - b.seq : a.kind.localeCompare(b.kind)));
		}

		return {
			edges,
			rootCandidates,
			rootThreadId,
			orchestratorThreadId,
			workerThreadIds,
			childrenByParent,
			hasSpawnEdges: edges.some((e) => e.kind === 'spawn'),
		};
	}, [collabItemsByThreadId, collabSeqByItemId, forkParentByThreadId, selectedThreadId, workbenchRootThreadId]);

	const sessionTree = useMemo(() => {
		const spawnEdges = workbenchGraph.edges.filter((edge) => edge.kind === 'spawn');
		const incomingCount: Record<string, number> = {};
		for (const edge of spawnEdges) {
			incomingCount[edge.to] = (incomingCount[edge.to] ?? 0) + 1;
		}

		const threadSummaryById = new Map(sessions.map((session) => [session.id, session]));
		const rootLabel = repoNameFromPath(activeThread?.cwd ?? workspaceRoot ?? '') || 'Workspace';
		const rootId = 'repo-root';
		const nodeIdByThreadId: Record<string, string> = {};
		const workerNodeIdByThreadId: Record<string, string> = {};
		const workerFilesNodeIdByThreadId: Record<string, string> = {};
		const nodeById: Record<string, TreeNodeData> = {};
		const archivedGroupNodeIdByKey: Record<string, string> = {};
		const archivedGroupThreadIdsByKey: Record<string, string[]> = {};
		const archivedGroupKeyByNodeId: Record<string, string> = {};
		const taskLatestUpdateMsByThreadId: Record<string, number | null> = {};

		const registerNode = (node: TreeNodeData) => {
			nodeById[node.id] = node;
		};

		const interactionCountFor = (threadId: string) => threadSummaryById.get(threadId)?.interactionCount ?? null;

		const normalizedWorktrees = worktrees.map((wt) => ({
			path: normalizePath(wt.path),
			branch: wt.branch ?? null,
		}));

		const worktreeLabelForThreadId = (threadId: string): string => {
			const cwd = threadSummaryById.get(threadId)?.cwd ?? null;
			if (!cwd) return 'wt-[unknown]';
			const normalizedCwd = normalizePath(cwd);

			let best: { path: string; branch: string | null } | null = null;
			for (const wt of normalizedWorktrees) {
				if (normalizedCwd === wt.path || normalizedCwd.startsWith(`${wt.path}/`)) {
					if (!best || wt.path.length > best.path.length) {
						best = wt;
					}
				}
			}

			if (!best) return 'wt-[unknown]';
			return best.branch ? `wt-[${best.branch}]` : 'wt-[detached]';
		};

		const buildFileNodes = (threadId: string, idPrefix: string, relativePath: string): TreeNodeData[] => {
			const entries = workspaceDirEntriesByPath[relativePath];
			if (!entries) return [];
			return entries.map((entry) => {
				const nodeId = `${idPrefix}:${entry.path}`;
				const node: TreeNodeData = {
					id: nodeId,
					type: entry.isDirectory ? 'folder' : 'file',
					label: entry.name,
					metadata: { threadId, path: entry.path },
				};
				registerNode(node);
				if (entry.isDirectory) {
					const hasLoadedChildren = Object.prototype.hasOwnProperty.call(workspaceDirEntriesByPath, entry.path);
					const childNodes = hasLoadedChildren ? buildFileNodes(threadId, idPrefix, entry.path) : [];
					node.children = hasLoadedChildren ? (childNodes.length > 0 ? childNodes : undefined) : [];
				}
				return node;
			});
		};

		const collectSpawnChildren = (fromId: string): string[] => {
			const ordered = spawnEdges.filter((edge) => edge.from === fromId).sort((a, b) => a.seq - b.seq);
			const out: string[] = [];
			const seen = new Set<string>();
			for (const edge of ordered) {
				if (!edge.to || seen.has(edge.to)) continue;
				seen.add(edge.to);
				out.push(edge.to);
			}
			return out;
		};

		const taskNodes: TreeNodeData[] = sessions
			.filter((session) => (incomingCount[session.id] ?? 0) === 0)
			.map((session): TreeNodeData => {
				const taskNodeId = `task-${session.id}`;
				nodeIdByThreadId[session.id] = taskNodeId;

				const children: TreeNodeData[] = [];
				const orchestratorId = collectSpawnChildren(session.id)[0] ?? null;
				const workerIds = orchestratorId ? collectSpawnChildren(orchestratorId) : [];
				const runningRoot = Boolean(runningThreadIds[session.id]);
				let taskIsActive = runningRoot;

				if (orchestratorId) {
					const orchestratorNodeId = `orchestrator-${orchestratorId}`;
					nodeIdByThreadId[orchestratorId] = orchestratorNodeId;

					const workerNodes: TreeNodeData[] = workerIds.map((workerId): TreeNodeData => {
						const workerNodeId = `worker-${workerId}`;
						const filesNodeId = `worker-${workerId}-files`;
						nodeIdByThreadId[workerId] = workerNodeId;
						workerNodeIdByThreadId[workerId] = workerNodeId;
						workerFilesNodeIdByThreadId[workerId] = filesNodeId;

						const workerRunning = Boolean(runningThreadIds[workerId]);
						taskIsActive = taskIsActive || workerRunning;

						const fileChildren = buildFileNodes(workerId, filesNodeId, '');
						const rootLoaded = Object.prototype.hasOwnProperty.call(workspaceDirEntriesByPath, '');
						const filesNode: TreeNodeData = {
							id: filesNodeId,
							type: 'folder',
							label: 'files',
							metadata: { threadId: workerId, path: '' },
							children: rootLoaded ? (fileChildren.length > 0 ? fileChildren : undefined) : [],
						};
						registerNode(filesNode);

						const workerNode: TreeNodeData = {
							id: workerNodeId,
							type: 'worker',
							label: labelForThread(threadSummaryById.get(workerId), workerId),
							interactionCount: interactionCountFor(workerId),
							isActive: workerRunning,
							status: workerRunning ? 'running' : undefined,
							metadata: { threadId: workerId, wtLabel: worktreeLabelForThreadId(workerId) },
							children: [filesNode],
						};
						registerNode(workerNode);
						return workerNode;
					});

					const orchestratorRunning = Boolean(runningThreadIds[orchestratorId]) || workerNodes.some((node) => node.isActive);
					taskIsActive = taskIsActive || orchestratorRunning;

					const orchestratorNode: TreeNodeData = {
						id: orchestratorNodeId,
						type: 'orchestrator',
						label: labelForThread(threadSummaryById.get(orchestratorId), orchestratorId),
						interactionCount: interactionCountFor(orchestratorId),
						isActive: orchestratorRunning,
						status: orchestratorRunning ? 'running' : undefined,
						metadata: { threadId: orchestratorId, wtLabel: worktreeLabelForThreadId(orchestratorId) },
						children: workerNodes,
					};
					registerNode(orchestratorNode);
					children.push(orchestratorNode);
				}

				const candidateThreadIds = [session.id, orchestratorId, ...workerIds].filter((threadId): threadId is string => Boolean(threadId));
				let latestUpdateMs: number | null = null;
				for (const threadId of candidateThreadIds) {
					const updatedAtMs = threadSummaryById.get(threadId)?.updatedAtMs ?? null;
					if (updatedAtMs == null) continue;
					if (latestUpdateMs == null || updatedAtMs > latestUpdateMs) {
						latestUpdateMs = updatedAtMs;
					}
				}
				taskLatestUpdateMsByThreadId[session.id] = latestUpdateMs;

				const taskNode: TreeNodeData = {
					id: taskNodeId,
					type: 'task',
					label: labelForThread(session, session.id),
					interactionCount: session.interactionCount ?? null,
					isActive: taskIsActive,
					status: taskIsActive ? 'running' : undefined,
					metadata: { threadId: session.id, wtLabel: worktreeLabelForThreadId(session.id) },
					children: children.length > 0 ? children : undefined,
				};
				registerNode(taskNode);
				return taskNode;
			});

		const nowMs = Date.now();
		const activeNodes: TreeNodeData[] = [];
		const archivedNodesByDate: Record<string, Record<string, TreeNodeData[]>> = {};
		for (const node of taskNodes) {
			const threadId = node.metadata?.threadId ?? '';
			const summary = threadSummaryById.get(threadId);
			const updatedAtMs = taskLatestUpdateMsByThreadId[threadId] ?? summary?.updatedAtMs ?? null;
			const isArchived = updatedAtMs != null && nowMs - updatedAtMs > 60 * 60 * 1000;
			if (!isArchived) {
				activeNodes.push(node);
				continue;
			}
			const date = updatedAtMs != null ? new Date(updatedAtMs) : new Date();
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			const dateKey = `${year}-${month}-${day}`;
			const hourKey = String(date.getHours()).padStart(2, '0');
			if (!archivedNodesByDate[dateKey]) {
				archivedNodesByDate[dateKey] = {};
			}
			if (!archivedNodesByDate[dateKey][hourKey]) {
				archivedNodesByDate[dateKey][hourKey] = [];
				archivedGroupThreadIdsByKey[`${dateKey}/${hourKey}`] = [];
			}
			archivedNodesByDate[dateKey][hourKey].push(node);
			archivedGroupThreadIdsByKey[`${dateKey}/${hourKey}`].push(threadId);
		}

		const archivedDateNodes: TreeNodeData[] = Object.keys(archivedNodesByDate)
			.sort()
			.map((dateKey) => {
				const hourGroups = archivedNodesByDate[dateKey];
				const hourNodes: TreeNodeData[] = Object.keys(hourGroups)
					.sort()
					.map((hourKey) => {
						const groupKey = `${dateKey}/${hourKey}`;
						const nodeId = `archived-group-${dateKey}-${hourKey}`;
						archivedGroupNodeIdByKey[groupKey] = nodeId;
						archivedGroupKeyByNodeId[nodeId] = groupKey;
						const hourNode: TreeNodeData = {
							id: nodeId,
							type: 'folder',
							label: hourKey,
							actions: [{ id: 'archive-group', title: 'Archive all sessions in this group' }],
							children: hourGroups[hourKey],
						};
						registerNode(hourNode);
						return hourNode;
					});

				const dateNode: TreeNodeData = {
					id: `archived-date-${dateKey}`,
					type: 'folder',
					label: dateKey,
					children: hourNodes,
				};
				registerNode(dateNode);
				return dateNode;
			});

		const archivedGroupRootNode: TreeNodeData = {
			id: 'archived-group',
			type: 'folder',
			label: 'Archived',
			children: archivedDateNodes,
		};
		registerNode(archivedGroupRootNode);

		const rootNode: TreeNodeData = {
			id: rootId,
			type: 'repo',
			label: rootLabel,
			children: [...activeNodes, archivedGroupRootNode],
		};
		registerNode(rootNode);
		const treeData: TreeNodeData[] = [rootNode];

		return {
			rootId,
			rootLabel,
			treeData,
			nodeIdByThreadId,
			workerNodeIdByThreadId,
			workerFilesNodeIdByThreadId,
			nodeById,
			archivedGroupNodeIdByKey,
			archivedGroupThreadIdsByKey,
			archivedGroupKeyByNodeId,
		};
	}, [activeThread?.cwd, normalizePath, sessions, runningThreadIds, workspaceRoot, workbenchGraph.edges, workspaceDirEntriesByPath, worktrees]);

	useEffect(() => {
		setSessionTreeExpandedNodes((prev) => {
			if (prev.has(sessionTree.rootId)) return prev;
			const next = new Set(prev);
			next.add(sessionTree.rootId);
			return next;
		});
	}, [sessionTree.rootId]);

	const toggleSessionTreeNode = useCallback(
		(nodeId: string) => {
			const isExpanded = sessionTreeExpandedNodesRef.current.has(nodeId);
			if (!isExpanded) {
				const node = sessionTree.nodeById[nodeId];
				if (node?.type === 'folder' && node.metadata?.path != null) {
					const path = node.metadata?.path ?? '';
					ensureWorkspaceDirectoryLoaded(path);
				}
			}
			setSessionTreeExpandedNodes((prev) => {
				const next = new Set(prev);
				if (next.has(nodeId)) {
					next.delete(nodeId);
				} else {
					next.add(nodeId);
				}
				return next;
			});
		},
		[ensureWorkspaceDirectoryLoaded, sessionTree.nodeById]
	);

	const expandSessionTreeNodes = useCallback((nodeIds: string[]) => {
		if (nodeIds.length === 0) return;
		setSessionTreeExpandedNodes((prev) => {
			const next = new Set(prev);
			for (const nodeId of nodeIds) {
				next.add(nodeId);
			}
			return next;
		});
	}, []);

	const selectedSessionTreeNodeId = useMemo(() => {
		if (selectedSessionTreeNodeOverride) return selectedSessionTreeNodeOverride;
		if (!selectedThreadId) return null;
		return sessionTree.nodeIdByThreadId[selectedThreadId] ?? null;
	}, [selectedSessionTreeNodeOverride, selectedThreadId, sessionTree.nodeIdByThreadId]);

	const openAgentPanel = useCallback(
		async (threadId: string, options?: { setAsWorkbenchRoot?: boolean }) => {
			if (!threadId) return;
			const tabId = `agent:${threadId}`;
			const title = labelForThread(
				sessions.find((s) => s.id === threadId),
				threadId
			);

			setPanelTabs((prev) => {
				const existing = prev.find((tab) => tab.id === tabId);
				if (existing) {
					// Keep title fresh when the session list updates.
					return prev.map((tab) => (tab.id === tabId && tab.kind === 'agent' ? { ...tab, title } : tab));
				}
				return [...prev, { id: tabId, kind: 'agent', threadId, title }];
			});

			setActiveMainTabId(tabId);

			// We still explicitly load here because some callers need special options like setAsWorkbenchRoot.
			if (selectedThreadId !== threadId || options?.setAsWorkbenchRoot) {
				await selectSession(threadId, options);
			}
		},
		[selectedThreadId, selectSession, sessions]
	);

	const openFilePreview = useCallback(
		(path: string) => {
			const normalizedPath = path.replace(/\\/g, '/');
			const tabId = `file:${normalizedPath}`;
			const existing = panelTabsRef.current.find((tab) => tab.id === tabId);
			setActiveMainTabId(tabId);

			if (!workspaceBasePath) {
				if (!existing) {
					setPanelTabs((prev) => [
						...prev,
						{
							id: tabId,
							kind: 'file',
							path: normalizedPath,
							title: baseName(normalizedPath),
							content: null,
							draft: '',
							dirty: false,
							loading: false,
							saving: false,
							showPreview: false,
							error: 'Workspace root not set.',
						},
					]);
				} else if (existing.kind === 'file' && !existing.error) {
					setPanelTabs((prev) => prev.map((tab) => (tab.id === tabId && tab.kind === 'file' ? { ...tab, error: 'Workspace root not set.' } : tab)));
				}
				return;
			}

			if (existing && existing.kind === 'file' && existing.content && !existing.error) return;
			if (existing?.kind === 'file' && existing.loading) return;

			if (!existing) {
				setPanelTabs((prev) => [
					...prev,
					{
						id: tabId,
						kind: 'file',
						path: normalizedPath,
						title: baseName(normalizedPath),
						content: null,
						draft: '',
						dirty: false,
						loading: true,
						saving: false,
						showPreview: false,
						error: null,
					},
				]);
			} else {
				setPanelTabs((prev) => prev.map((tab) => (tab.id === tabId && tab.kind === 'file' ? { ...tab, loading: true, error: null } : tab)));
			}

			void (async () => {
				try {
					const fullPath = normalizedPath.startsWith('/') ? normalizedPath : `${workspaceBasePath}/${normalizedPath}`;
					const content = await apiClient.readFileContent(fullPath);
					setPanelTabs((prev) =>
						prev.map((tab) =>
							tab.id === tabId && tab.kind === 'file'
								? {
										...tab,
										content,
										draft: content,
										dirty: false,
										loading: false,
										error: null,
									}
								: tab
						)
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to load file';
					setPanelTabs((prev) => prev.map((tab) => (tab.id === tabId && tab.kind === 'file' ? { ...tab, loading: false, error: message } : tab)));
				}
			})();
		},
		[workspaceBasePath]
	);

	const setFileTabDraft = useCallback((tabId: string, draft: string) => {
		setPanelTabs((prev) =>
			prev.map((tab) => {
				if (tab.id !== tabId || tab.kind !== 'file') return tab;
				const dirty = tab.content == null ? draft.length > 0 : draft !== tab.content;
				return { ...tab, draft, dirty };
			})
		);
	}, []);

	const toggleFileTabPreview = useCallback((tabId: string) => {
		setPanelTabs((prev) => prev.map((tab) => (tab.id === tabId && tab.kind === 'file' ? { ...tab, showPreview: !tab.showPreview } : tab)));
	}, []);

	const saveFileTab = useCallback(
		async (tabId: string) => {
			const tab = panelTabsRef.current.find((t): t is FilePanelTab => t.id === tabId && t.kind === 'file');
			if (!tab) return;
			if (!workspaceBasePath) {
				setPanelTabs((prev) => prev.map((t) => (t.id === tabId && t.kind === 'file' ? { ...t, error: 'Workspace root not set.' } : t)));
				return;
			}
			if (tab.path.startsWith('/')) {
				setPanelTabs((prev) =>
					prev.map((t) => (t.id === tabId && t.kind === 'file' ? { ...t, error: 'Saving absolute paths is not supported in this build.' } : t))
				);
				return;
			}

			setPanelTabs((prev) => prev.map((t) => (t.id === tabId && t.kind === 'file' ? { ...t, saving: true, error: null } : t)));

			try {
				await apiClient.workspaceWriteFile(workspaceBasePath, tab.path, tab.draft);
				setPanelTabs((prev) =>
					prev.map((t) => (t.id === tabId && t.kind === 'file' ? { ...t, saving: false, content: tab.draft, dirty: false, error: null } : t))
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to save file';
				setPanelTabs((prev) => prev.map((t) => (t.id === tabId && t.kind === 'file' ? { ...t, saving: false, error: message } : t)));
			}
		},
		[workspaceBasePath]
	);

	const closePanelTab = useCallback(
		async (tabId: string) => {
			const current = panelTabsRef.current;
			const idx = current.findIndex((tab) => tab.id === tabId);
			if (idx < 0) return;
			const target = current[idx];

			if (target.kind === 'file' && target.dirty) {
				const confirmed = await dialogConfirm('This file has unsaved changes. Close anyway?', {
					title: 'Close file',
					kind: 'warning',
				});
				if (!confirmed) return;
			}

			const nextTabs = current.filter((tab) => tab.id !== tabId);
			setPanelTabs(nextTabs);

			if (activeMainTabIdRef.current === tabId) {
				const fallback = nextTabs[idx - 1] ?? nextTabs[idx] ?? null;
				setActiveMainTabId(fallback?.id ?? null);
			}
		},
		[setPanelTabs]
	);

	const handleSessionTreeSelect = useCallback(
		(node: TreeNodeData) => {
			if (node.type === 'file') {
				setSelectedSessionTreeNodeOverride(node.id);
				setIsWorkbenchEnabled(false);
				const path = node.metadata?.path;
				if (path) {
					void openFilePreview(path);
				}
				return;
			}

			if (node.type === 'folder') {
				setSelectedSessionTreeNodeOverride(node.id);
				if (node.metadata?.path != null) {
					const path = node.metadata?.path ?? '';
					ensureWorkspaceDirectoryLoaded(path);
				}
				return;
			}

			const threadId = node.metadata?.threadId;
			if (!threadId) return;
			setSelectedSessionTreeNodeOverride(null);
			setIsWorkbenchEnabled(false);

			if (node.type === 'task') {
				void openAgentPanel(threadId, { setAsWorkbenchRoot: true });
				return;
			}

			if (node.type === 'worker') {
				void openAgentPanel(threadId);
				const workerNodeId = sessionTree.workerNodeIdByThreadId[threadId];
				const filesNodeId = sessionTree.workerFilesNodeIdByThreadId[threadId];
				const expandIds = [workerNodeId, filesNodeId].filter((id): id is string => Boolean(id));
				expandSessionTreeNodes(expandIds);
				ensureWorkspaceDirectoryLoaded('');
				return;
			}

			if (node.type === 'orchestrator') {
				void openAgentPanel(threadId);
			}
		},
		[
			expandSessionTreeNodes,
			ensureWorkspaceDirectoryLoaded,
			openAgentPanel,
			openFilePreview,
			setIsWorkbenchEnabled,
			sessionTree.workerFilesNodeIdByThreadId,
			sessionTree.workerNodeIdByThreadId,
		]
	);

	const closeTaskContextMenu = useCallback(() => setTaskContextMenu(null), []);
	const closePanelTabContextMenu = useCallback(() => setPanelTabContextMenu(null), []);

	useEffect(() => {
		if (!taskContextMenu) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setTaskContextMenu(null);
			}
		};
		const handlePointerDown = () => setTaskContextMenu(null);

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('mousedown', handlePointerDown);
		// Close on scroll too (captures scroll in nested containers).
		window.addEventListener('scroll', handlePointerDown, true);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('mousedown', handlePointerDown);
			window.removeEventListener('scroll', handlePointerDown, true);
		};
	}, [taskContextMenu]);

	useEffect(() => {
		if (!panelTabContextMenu) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setPanelTabContextMenu(null);
			}
		};
		const handlePointerDown = () => setPanelTabContextMenu(null);

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('mousedown', handlePointerDown);
		// Close on scroll too (captures scroll in nested containers).
		window.addEventListener('scroll', handlePointerDown, true);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('mousedown', handlePointerDown);
			window.removeEventListener('scroll', handlePointerDown, true);
		};
	}, [panelTabContextMenu]);

	const renameTaskDialogThreadId = renameTaskDialog?.threadId;
	useEffect(() => {
		// Only focus/select when the dialog opens (or the target thread changes).
		// Depending on the full `renameTaskDialog` object would re-run on every keystroke
		// because `value` changes on input.
		if (!renameTaskDialogThreadId) return;
		renameTaskInputRef.current?.focus();
		renameTaskInputRef.current?.select();
	}, [renameTaskDialogThreadId]);

	const renameFileDialogTabId = renameFileDialog?.tabId;
	useEffect(() => {
		// Only focus/select when the dialog opens (or the target tab changes).
		// Depending on the full `renameFileDialog` object would re-run on every keystroke
		// because `value` changes on input.
		if (!renameFileDialogTabId) return;
		renameFileInputRef.current?.focus();
		renameFileInputRef.current?.select();
	}, [renameFileDialogTabId]);

	const handleSessionTreeContextMenu = useCallback((node: TreeNodeData, event: React.MouseEvent) => {
		if (node.type !== 'task') return;
		const threadId = node.metadata?.threadId;
		if (!threadId) return;
		event.preventDefault();
		event.stopPropagation();
		setTaskContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, threadId });
	}, []);

	const collectThreadIdsInNode = useCallback((root: TreeNodeData): string[] => {
		const out: string[] = [];
		const seen = new Set<string>();
		const walk = (node: TreeNodeData) => {
			const threadId = node.metadata?.threadId;
			if (threadId && !seen.has(threadId)) {
				seen.add(threadId);
				out.push(threadId);
			}
			for (const child of node.children ?? []) {
				walk(child);
			}
		};
		walk(root);
		return out;
	}, []);

	const renameTaskThread = useCallback(
		(threadId: string) => {
			const summary = sessions.find((s) => s.id === threadId) ?? null;
			const defaultTitle = (summary?.title ?? summary?.preview ?? '').trim();
			setRenameTaskDialog({ threadId, value: defaultTitle, error: null });
		},
		[sessions]
	);

	const closeRenameTaskDialog = useCallback(() => {
		setRenameTaskDialog(null);
	}, []);

	const submitRenameTask = useCallback(async () => {
		if (!renameTaskDialog) return;
		const next = renameTaskDialog.value.trim();
		if (!next) {
			setRenameTaskDialog((prev) => (prev ? { ...prev, error: 'Title must not be empty.' } : prev));
			return;
		}
		try {
			await apiClient.codexThreadTitleSet(renameTaskDialog.threadId, next);
			setRenameTaskDialog(null);
			await listSessions();
		} catch (err) {
			setRenameTaskDialog((prev) => (prev ? { ...prev, error: errorMessage(err, 'Failed to rename task') } : prev));
		}
	}, [listSessions, renameTaskDialog]);

	const renameFileTab = useCallback((tabId: string) => {
		const tab = panelTabsRef.current.find((t): t is FilePanelTab => t.id === tabId && t.kind === 'file');
		if (!tab) return;
		setRenameFileDialog({ tabId, fromPath: tab.path, value: baseName(tab.path), error: null });
	}, []);

	const closeRenameFileDialog = useCallback(() => {
		setRenameFileDialog(null);
	}, []);

	const submitRenameFile = useCallback(async () => {
		if (!renameFileDialog) return;

		const nextName = renameFileDialog.value.trim();
		if (!nextName) {
			setRenameFileDialog((prev) => (prev ? { ...prev, error: 'File name must not be empty.' } : prev));
			return;
		}
		if (nextName.includes('/') || nextName.includes('\\')) {
			setRenameFileDialog((prev) => (prev ? { ...prev, error: 'Only same-folder renames are supported. Please enter a file name without / or \\.' } : prev));
			return;
		}

		if (!workspaceBasePath) {
			setRenameFileDialog((prev) => (prev ? { ...prev, error: 'Workspace root not set.' } : prev));
			return;
		}

		const fromPath = renameFileDialog.fromPath.replace(/\\/g, '/');
		if (fromPath.startsWith('/')) {
			setRenameFileDialog((prev) => (prev ? { ...prev, error: 'Renaming absolute paths is not supported in this build.' } : prev));
			return;
		}

		const lastSlash = fromPath.lastIndexOf('/');
		const parentDir = lastSlash >= 0 ? fromPath.slice(0, lastSlash) : '';
		const toPath = parentDir ? `${parentDir}/${nextName}` : nextName;
		if (toPath === fromPath) {
			setRenameFileDialog(null);
			return;
		}

		const nextTabId = `file:${toPath}`;
		if (panelTabsRef.current.some((t) => t.id === nextTabId)) {
			setRenameFileDialog((prev) => (prev ? { ...prev, error: 'A tab for the target file path is already open. Close it first.' } : prev));
			return;
		}

		try {
			await apiClient.workspaceRenameFile(workspaceBasePath, fromPath, toPath);

			// Update the open tab to point at the new file path.
			setPanelTabs((prev) =>
				prev.map((t) => {
					if (t.id !== renameFileDialog.tabId || t.kind !== 'file') return t;
					return { ...t, id: nextTabId, path: toPath, title: baseName(toPath) };
				})
			);
			setActiveMainTabId((prev) => (prev === renameFileDialog.tabId ? nextTabId : prev));

			// Keep the session tree selection consistent when a selected file is renamed.
			setSelectedSessionTreeNodeOverride((prev) => {
				if (!prev) return prev;
				const suffix = `:${fromPath}`;
				if (!prev.endsWith(suffix)) return prev;
				return `${prev.slice(0, prev.length - suffix.length)}:${toPath}`;
			});

			// Refresh just the parent directory listing (avoid a full tree reload).
			await loadWorkspaceDirectory(parentDir);

			setRenameFileDialog(null);
		} catch (err) {
			setRenameFileDialog((prev) => (prev ? { ...prev, error: errorMessage(err, 'Failed to rename file') } : prev));
		}
	}, [loadWorkspaceDirectory, renameFileDialog, workspaceBasePath]);

	const archiveTaskNode = useCallback(
		async (taskNodeId: string) => {
			const inFlight = archiveTaskInFlightRef.current;
			if (inFlight.has(taskNodeId)) return;
			inFlight.add(taskNodeId);
			const release = () => inFlight.delete(taskNodeId);

			const root = sessionTree.nodeById[taskNodeId];
			if (!root) {
				release();
				return;
			}
			const threadIds = collectThreadIdsInNode(root);
			if (threadIds.length === 0) {
				release();
				return;
			}

			const confirmed = await dialogConfirm(`Archive this task and its ${threadIds.length - 1} descendant thread(s)?`, {
				title: 'Archive',
				kind: 'warning',
			});
			if (!confirmed) {
				release();
				return;
			}

			try {
				for (const id of threadIds) {
					try {
						await apiClient.codexThreadArchive(id);
					} finally {
						setThreadRunning(id, false);
					}
				}

				// Close any open agent panels that belong to the archived task threads.
				{
					const currentTabs = panelTabsRef.current;
					const activeId = activeMainTabIdRef.current;

					const nextTabs = currentTabs.filter((tab) => tab.kind !== 'agent' || !threadIds.includes(tab.threadId));
					if (nextTabs.length !== currentTabs.length) {
						setPanelTabs(nextTabs);
						if (activeId && !nextTabs.some((tab) => tab.id === activeId)) {
							const removedIdx = currentTabs.findIndex((tab) => tab.id === activeId);
							const fallback = nextTabs[removedIdx - 1] ?? nextTabs[removedIdx] ?? null;
							setActiveMainTabId(fallback?.id ?? null);
						}
					}
				}

				if (selectedThreadId && threadIds.includes(selectedThreadId)) {
					setTurnOrder([]);
					setTurnsById({});
					setThreadTokenUsage(null);
					setCollapsedWorkingByTurnId({});
					setItemToTurnId({});
					itemToTurnRef.current = {};
					setCollapsedByEntryId({});
					setActiveThread(null);
					setActiveTurnId(null);
					setSelectedThreadId(null);
					setSelectedSessionTreeNodeOverride(null);
					setIsWorkbenchEnabled(false);
					setWorkbenchRootThreadId(null);
				}

				await listSessions();
			} catch (err) {
				await dialogMessage(errorMessage(err, 'Failed to archive task'), { title: 'Delete', kind: 'error' });
			} finally {
				release();
			}
		},
		[
			collectThreadIdsInNode,
			listSessions,
			panelTabsRef,
			selectedThreadId,
			sessionTree.nodeById,
			setThreadRunning,
			setActiveMainTabId,
			setPanelTabs,
			setIsWorkbenchEnabled,
		]
	);

	const archiveArchivedGroup = useCallback(
		async (groupKey: string) => {
			const threadIds = sessionTree.archivedGroupThreadIdsByKey[groupKey] ?? [];
			if (threadIds.length === 0) return;
			const confirmed = await dialogConfirm(`Archive ${threadIds.length} session(s) in ${groupKey}?`, {
				title: 'Archive',
				kind: 'warning',
			});
			if (!confirmed) return;
			try {
				for (const id of threadIds) {
					try {
						await apiClient.codexThreadArchive(id);
					} finally {
						setThreadRunning(id, false);
					}
				}
				await listSessions();
			} catch (err) {
				await dialogMessage(errorMessage(err, 'Failed to archive group'), { title: 'Archive', kind: 'error' });
			}
		},
		[listSessions, sessionTree.archivedGroupThreadIdsByKey, setThreadRunning]
	);

	const collabAgentStateByThreadId = useMemo(() => {
		type State = { status: string; message: string | null; seq: number };
		const out: Record<string, State> = {};

		for (const byId of Object.values(collabItemsByThreadId)) {
			for (const item of Object.values(byId)) {
				const seq = collabSeqByItemId[item.id] ?? Number.MAX_SAFE_INTEGER;
				const agents = item.agentsStates ?? {};
				for (const [threadId, raw] of Object.entries(agents)) {
					const status = safeString((raw as any)?.status);
					const message = typeof (raw as any)?.message === 'string' ? (raw as any).message : null;
					const prev = out[threadId];
					if (!prev || seq > prev.seq) {
						out[threadId] = { status, message, seq };
					}
				}
			}
		}

		return out;
	}, [collabItemsByThreadId, collabSeqByItemId]);

	useEffect(() => {
		if (!isWorkbenchEnabled || !workbenchAutoFocus) return;
		if (autoFocusInFlightRef.current) return;

		const running = Object.entries(collabAgentStateByThreadId)
			.filter(([, st]) => st.status === 'running')
			.sort((a, b) => b[1].seq - a[1].seq)
			.map(([threadId]) => threadId);

		let candidate: string | null = null;
		for (const threadId of running) {
			if (workbenchGraph.workerThreadIds.includes(threadId)) {
				candidate = threadId;
				break;
			}
		}
		if (!candidate && workbenchGraph.orchestratorThreadId) {
			if (running.includes(workbenchGraph.orchestratorThreadId)) {
				candidate = workbenchGraph.orchestratorThreadId;
			}
		}
		if (!candidate) candidate = running[0] ?? null;

		// Fallback: use turn started/completed notifications.
		if (!candidate) {
			const runningTurnThreadIds = Object.keys(runningThreadIds).filter((t) => runningThreadIds[t]);
			candidate = runningTurnThreadIds[0] ?? null;
		}

		if (!candidate) return;
		if (candidate === selectedThreadId) return;
		if (candidate === lastAutoFocusedThreadRef.current) return;

		autoFocusInFlightRef.current = true;
		lastAutoFocusedThreadRef.current = candidate;
		void (async () => {
			try {
				await openAgentPanel(candidate);
			} finally {
				autoFocusInFlightRef.current = false;
			}
		})();
	}, [
		collabAgentStateByThreadId,
		isWorkbenchEnabled,
		runningThreadIds,
		selectedThreadId,
		openAgentPanel,
		workbenchAutoFocus,
		workbenchGraph.orchestratorThreadId,
		workbenchGraph.workerThreadIds,
	]);

	const applyProfile = useCallback(
		async (nextProfile: string) => {
			if (nextProfile === selectedProfile) return;
			const runningFocusedTurn = activeTurnId ? turnsById[activeTurnId]?.status === 'inProgress' : false;
			if (runningFocusedTurn) {
				const confirmed = await dialogConfirm('Switching profile will stop the running turn and resume the session. Continue?', {
					title: 'Switch profile',
					kind: 'warning',
				});
				if (!confirmed) return;
			}

			setStatusPopoverError(null);
			const prevProfile = selectedProfile;
			setSelectedProfile(nextProfile);
			setOpenStatusPopover(null);

			try {
				await apiClient.codexSetProfile(nextProfile);
				if (selectedThreadId) {
					await selectSession(selectedThreadId);
				}
				await loadModelsAndChatDefaults();
			} catch (err) {
				setSelectedProfile(prevProfile);
				setStatusPopoverError(errorMessage(err, 'Failed to switch profile'));
			}
		},
		[activeTurnId, loadModelsAndChatDefaults, selectedProfile, selectedThreadId, selectSession, turnsById]
	);

	const createNewSession = useCallback(async () => {
		setTurnOrder([]);
		setTurnsById({});
		setThreadTokenUsage(null);
		setCollapsedWorkingByTurnId({});
		setItemToTurnId({});
		itemToTurnRef.current = {};
		setCollapsedByEntryId({});
		setActiveThread(null);
		setActiveTurnId(null);
		setSelectedThreadId(null);
		try {
			const res = await apiClient.codexThreadStart(selectedModel, { cwd: activeWorktreePath ?? workspaceRoot ?? null });
			const thread = normalizeThreadFromResponse(res);
			if (thread?.id) {
				await openAgentPanel(thread.id);
			}
			await listSessions();
		} catch (err) {
			const turnId = PENDING_TURN_ID;
			setTurnOrder([turnId]);
			setTurnsById({
				[turnId]: {
					id: turnId,
					status: 'failed',
					entries: [
						{
							kind: 'system',
							id: 'system-new',
							tone: 'error',
							text: errorMessage(err, 'Failed to start thread'),
						},
					],
				},
			});
		}
	}, [activeWorktreePath, listSessions, openAgentPanel, selectedModel, workspaceRoot]);

	const forkFromTurn = useCallback(
		async (requestedTurnId: string) => {
			if (!selectedThreadId) return;

			const uiTurnIds = turnOrder.filter((id) => id && id !== PENDING_TURN_ID);
			if (uiTurnIds.length === 0) return;

			let startIdx = uiTurnIds.indexOf(requestedTurnId);
			if (startIdx < 0) startIdx = uiTurnIds.length - 1;

			// Find the nearest stable turn (not in progress). This avoids trying to fork from a
			// running turn; we will "walk back" to the most recent completed/failed/interrupted turn.
			let candidateIdx = -1;
			for (let idx = startIdx; idx >= 0; idx -= 1) {
				const id = uiTurnIds[idx];
				const status = turnsById[id]?.status ?? 'unknown';
				if (status !== 'inProgress') {
					candidateIdx = idx;
					break;
				}
			}
			if (candidateIdx < 0) {
				try {
					await dialogMessage('No completed turns to fork from yet.', { title: 'Fork', kind: 'error' });
				} catch {
					// ignore
				}
				return;
			}

			setIsSettingsMenuOpen(false);

			try {
				// Prefer path-based fork so we can fork from the latest persisted history even if
				// the source thread is currently generating (unstable protocol field, but works well
				// for "fork from a completed turn" UX).
				const forkPath = activeThread?.id === selectedThreadId ? (activeThread?.path ?? null) : null;
				const res = await apiClient.codexThreadFork(selectedThreadId, { path: forkPath });
				const forked = normalizeThreadFromResponse(res);
				if (!forked?.id) throw new Error('Failed to parse thread/fork response');

				// After forking, rollback the new thread so it ends at the requested (or nearest prior) turn.
				const forkedTurnIds = (forked.turns ?? []).map((t) => t.id).filter(Boolean);
				let forkPointIdxInForked = -1;

				// If the forked history is behind the UI state (e.g. source thread is still running),
				// walk backwards until we find a turn that exists in the forked thread.
				for (let idx = candidateIdx; idx >= 0; idx -= 1) {
					const turnId = uiTurnIds[idx];
					const found = forkedTurnIds.indexOf(turnId);
					if (found >= 0) {
						forkPointIdxInForked = found;
						break;
					}
				}

				// Some servers synthesize turn ids on resume/fork (e.g. "turn-1", "turn-2"...), so
				// turn ids may not match the currently running UI turn ids. Prefer id-matching when it
				// works, but fall back to position-based mapping so the rollback lands on the expected
				// turn index.
				if (forkPointIdxInForked < 0 && forkedTurnIds.length > 0) {
					forkPointIdxInForked = Math.min(candidateIdx, forkedTurnIds.length - 1);
				}

				const rollbackTurns = forkPointIdxInForked < 0 ? 0 : Math.max(0, forkedTurnIds.length - 1 - forkPointIdxInForked);
				if (rollbackTurns > 0) {
					await apiClient.codexThreadRollback(forked.id, rollbackTurns);
				}

				setForkParentByThreadId((prev) => ({ ...prev, [forked.id]: selectedThreadId }));
				await openAgentPanel(forked.id);
				await listSessions();
			} catch (err) {
				try {
					await dialogMessage(errorMessage(err, 'Failed to fork session'), {
						title: 'Fork session',
						kind: 'error',
					});
				} catch {
					// ignore
				}
			}
		},
		[activeThread?.id, activeThread?.path, listSessions, openAgentPanel, selectedThreadId, turnOrder, turnsById]
	);

	const forkThreadLatest = useCallback(
		async (threadId: string) => {
			if (!threadId) return;
			setIsSettingsMenuOpen(false);
			try {
				const res = await apiClient.codexThreadFork(threadId);
				const thread = normalizeThreadFromResponse(res);
				if (!thread?.id) throw new Error('Failed to parse thread/fork response');
				setForkParentByThreadId((prev) => ({ ...prev, [thread.id]: threadId }));
				await openAgentPanel(thread.id);
				await listSessions();
			} catch (err) {
				try {
					await dialogMessage(errorMessage(err, 'Failed to fork session'), {
						title: 'Fork session',
						kind: 'error',
					});
				} catch {
					// ignore
				}
			}
		},
		[listSessions, openAgentPanel]
	);

	const applyWorkspaceRoot = useCallback(
		async (nextRoot: string) => {
			setWorkspaceRootError(null);

			try {
				const root = await apiClient.workspaceRootSet(nextRoot);
				setWorkspaceRoot(root);
			} catch (err) {
				setWorkspaceRootError(errorMessage(err, 'Failed to set workspace root'));
				return;
			}

			void loadRecentWorkspaces();
			setIsWorkspaceMenuOpen(false);
			await createNewSession();
		},
		[createNewSession, loadRecentWorkspaces]
	);

	const openWorkspaceDialog = useCallback(async () => {
		setIsWorkspaceMenuOpen(false);
		let selection: string | string[] | null;
		try {
			selection = await openDialog({ directory: true, multiple: false });
		} catch (err) {
			setWorkspaceRootError(errorMessage(err, 'Directory picker is unavailable in this build'));
			return;
		}
		const selectedPath = Array.isArray(selection) ? selection[0] : selection;
		if (typeof selectedPath !== 'string' || selectedPath.length === 0) return;
		await applyWorkspaceRoot(selectedPath);
	}, [applyWorkspaceRoot]);

	const openNewWindow = useCallback(async () => {
		setIsWorkspaceMenuOpen(false);
		try {
			await apiClient.windowNew();
		} catch (err) {
			setWorkspaceRootError(errorMessage(err, 'Failed to open new window'));
		}
	}, []);

	const showAbout = useCallback(async () => {
		setIsWorkspaceMenuOpen(false);
		try {
			const version = await getVersion();
			await dialogMessage(`Coco\nVersion ${version}`, 'About Coco');
		} catch {
			try {
				await dialogMessage('Coco', 'About Coco');
			} catch {
				// ignore
			}
		}
	}, []);

	const showUpdates = useCallback(async () => {
		setIsWorkspaceMenuOpen(false);
		try {
			await dialogMessage('Auto-updates are not implemented in this build.', {
				title: 'Check for Updates',
				kind: 'info',
			});
		} catch {
			// ignore
		}
	}, []);

	const sendMessage = useCallback(async () => {
		const userInput = input;
		const trimmedInput = userInput.trim();
		const hasImageAttachments = fileAttachments.some((att) => att.kind === 'image' || att.kind === 'localImage');
		// Allow sending if there's text, or if a skill/prompt is selected, or if images are attached.
		if (!trimmedInput && !selectedSkill && !selectedPrompt && !hasImageAttachments) return;

		// Prevent duplicate sends if the handler fires twice before React applies the disabled state.
		if (sendInFlightRef.current) return;
		sendInFlightRef.current = true;
		setSending(true);

		try {
			// Build attachments list for UI display
			const attachments: AttachmentItem[] = [];
			for (const f of fileAttachments) {
				if (f.kind === 'file') {
					attachments.push({ type: 'file', path: f.path, name: f.name });
					continue;
				}
				if (f.kind === 'image') {
					attachments.push({ type: 'image', url: f.dataUrl, name: f.name });
					continue;
				}
				if (f.kind === 'localImage') {
					attachments.push({ type: 'localImage', path: f.path, name: f.name });
				}
			}
			if (selectedSkill) {
				attachments.push({ type: 'skill', name: selectedSkill.name });
			}
			if (selectedPrompt) {
				attachments.push({ type: 'prompt', name: selectedPrompt.name });
			}

			let threadId = selectedThreadId;
			let currentRepoPath = effectiveCwd;
			if (!threadId) {
				const res = await apiClient.codexThreadStart(selectedModel, { cwd: activeWorktreePath ?? workspaceRoot ?? null });
				const thread = normalizeThreadFromResponse(res);
				if (!thread) throw new Error('Failed to start thread');
				threadId = thread.id;
				currentRepoPath = thread.cwd ?? null;
				setSelectedThreadId(threadId);
				setActiveThread(thread);
				setActiveWorktreePath(thread.cwd ?? activeWorktreePath ?? workspaceRoot ?? null);
				await listSessions();
			}

			const outgoingText = autoContextEnabled
				? wrapUserInputWithRepoContext({
						userInput,
						currentRepoPath,
						relatedRepoPaths,
					})
				: userInput;

			// Build CodexUserInput array for API
			const codexInput: CodexUserInput[] = [];

			// Add images first (TUI parity).
			for (const att of fileAttachments) {
				if (att.kind === 'image') {
					codexInput.push({ type: 'image', url: att.dataUrl });
				} else if (att.kind === 'localImage') {
					codexInput.push({ type: 'localImage', path: att.path });
				}
			}

			// Add text input (keep old behavior: always include text, even if empty).
			codexInput.push({ type: 'text', text: outgoingText });

			// Add skill with name and path
			if (selectedSkill) {
				codexInput.push({ type: 'skill', name: selectedSkill.name, path: selectedSkill.path });
			}

			// Create user entry with attachments
			const userEntry: ChatEntry = {
				kind: 'user',
				id: `user-${crypto.randomUUID()}`,
				text: outgoingText.trim(),
				attachments: attachments.length > 0 ? attachments : undefined,
			};

			setTurnOrder((prev) => (prev.includes(PENDING_TURN_ID) ? prev : [...prev, PENDING_TURN_ID]));
			setTurnsById((prev) => {
				const existing = prev[PENDING_TURN_ID] ?? {
					id: PENDING_TURN_ID,
					status: 'inProgress' as const,
					entries: [],
				};
				return {
					...prev,
					[PENDING_TURN_ID]: {
						...existing,
						status: 'inProgress',
						entries: [...existing.entries, userEntry],
					},
				};
			});
			setInput('');
			setSelectedSkill(null);
			setSelectedPrompt(null);
			setFileAttachments([]);
			await apiClient.codexTurnStart(threadId, codexInput, selectedModel, selectedEffort, approvalPolicy, activeWorktreePath ?? null);
		} catch (err) {
			const systemEntry: ChatEntry = {
				kind: 'system',
				id: `system-send-${crypto.randomUUID()}`,
				tone: 'error',
				text: errorMessage(err, 'Failed to send'),
			};
			setTurnOrder((prev) => (prev.includes(PENDING_TURN_ID) ? prev : [...prev, PENDING_TURN_ID]));
			setTurnsById((prev) => {
				const existing = prev[PENDING_TURN_ID] ?? {
					id: PENDING_TURN_ID,
					status: 'failed' as const,
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
			sendInFlightRef.current = false;
			setSending(false);
		}
	}, [
		approvalPolicy,
		activeWorktreePath,
		autoContextEnabled,
		effectiveCwd,
		input,
		listSessions,
		relatedRepoPaths,
		workspaceRoot,
		selectedEffort,
		selectedModel,
		selectedThreadId,
		fileAttachments,
		selectedSkill,
		selectedPrompt,
	]);

	const resolveTurnIdForEntry = useCallback(
		(entryId: string): string | null => {
			const direct = itemToTurnRef.current[entryId];
			if (direct) return direct;
			for (const [turnId, turn] of Object.entries(turnsById)) {
				if (turn.entries.some((entry) => entry.id === entryId)) return turnId;
			}
			return null;
		},
		[turnsById]
	);

	const normalizeRerunAttachments = useCallback(
		(attachments: AttachmentItem[]): AttachmentItem[] => {
			const out: AttachmentItem[] = [];
			const seen = new Set<string>();
			const hasSkillCatalog = skills.length > 0;
			const hasPromptCatalog = prompts.length > 0;
			for (const att of attachments) {
				if (att.type === 'skill') {
					if (hasSkillCatalog && !skills.some((skill) => skill.name === att.name)) continue;
				}
				if (att.type === 'prompt') {
					if (hasPromptCatalog && !prompts.some((prompt) => prompt.name === att.name)) continue;
				}
				const key = attachmentDedupKey(att);
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(att);
			}
			return out;
		},
		[prompts, skills]
	);

	const requestUserEntryRerun = useCallback(
		async (entry: Extract<ChatEntry, { kind: 'user' }>, draft: { text: string; attachments: AttachmentItem[] }) => {
			if (!selectedThreadId) {
				await dialogMessage('请先选择一个会话。', { title: '重新运行', kind: 'error' });
				return false;
			}

			const trimmedInput = draft.text.trim();
			const normalizedAttachments = normalizeRerunAttachments(draft.attachments);
			const hasSkill = normalizedAttachments.some((att) => att.type === 'skill');
			const hasPrompt = normalizedAttachments.some((att) => att.type === 'prompt');
			const hasImage = normalizedAttachments.some((att) => att.type === 'image' || att.type === 'localImage');
			if (!trimmedInput && !hasSkill && !hasPrompt && !hasImage) {
				await dialogMessage('消息为空。', { title: '重新运行', kind: 'error' });
				return false;
			}

			const targetTurnId = resolveTurnIdForEntry(entry.id);
			if (!targetTurnId) {
				await dialogMessage('未能定位到目标回合。', { title: '重新运行', kind: 'error' });
				return false;
			}

			const realTurnIds = turnOrder.filter((id) => id && id !== PENDING_TURN_ID);
			const targetIdx = realTurnIds.indexOf(targetTurnId);
			if (targetIdx < 0) {
				await dialogMessage('未能在顺序中定位到目标回合。', { title: '重新运行', kind: 'error' });
				return false;
			}

			const rollbackTurns = realTurnIds.length - targetIdx;
			if (rollbackTurns <= 0) return false;

			const isRunning = Boolean(runningThreadIds[selectedThreadId]);
			if (isRunning && activeTurnId) {
				try {
					await apiClient.codexTurnInterrupt(selectedThreadId, activeTurnId);
				} catch {
					// Best-effort; continue to attempt rollback.
				}
			}

			try {
				await apiClient.codexThreadRollback(selectedThreadId, rollbackTurns);
				await selectSession(selectedThreadId);
				await listSessions();
			} catch (err) {
				await dialogMessage(errorMessage(err, '从该消息重新运行失败'), { title: '重新运行', kind: 'error' });
				return false;
			}

			const nextSkillName = normalizedAttachments.find((att) => att.type === 'skill')?.name ?? null;
			const nextPromptName = normalizedAttachments.find((att) => att.type === 'prompt')?.name ?? null;
			const nextSkill = nextSkillName ? (skills.find((skill) => skill.name === nextSkillName) ?? null) : null;
			const nextPrompt = nextPromptName ? (prompts.find((prompt) => prompt.name === nextPromptName) ?? null) : null;

			const isAbsolutePath = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
			const cwd = effectiveCwd ?? '.';
			const fileItems = normalizedAttachments.filter((att) => att.type === 'file') as Extract<AttachmentItem, { type: 'file' }>[];
			const imageItems = normalizedAttachments.filter((att) => att.type === 'image') as Extract<AttachmentItem, { type: 'image' }>[];
			const localImageItems = normalizedAttachments.filter((att) => att.type === 'localImage') as Extract<AttachmentItem, { type: 'localImage' }>[];

			const fileResults = await Promise.all(
				fileItems.map(async (att) => {
					const fullPath = isAbsolutePath(att.path) ? att.path : `${cwd}/${att.path}`;
					try {
						const content = await apiClient.readFileContent(fullPath);
						return {
							kind: 'file' as const,
							id: att.path,
							path: att.path,
							name: att.name,
							content,
						};
					} catch {
						return null;
					}
				})
			);

			const imageResults: FileAttachment[] = imageItems.map((att) => {
				const mimeMatch = att.url.match(/^data:(image\/[^;]+);base64,/);
				const mimeType = mimeMatch?.[1] ?? 'image/*';
				return {
					kind: 'image',
					id: attachmentDedupKey(att),
					name: att.name || guessImageNameFromDataUrl(att.url),
					sizeBytes: 0,
					mimeType,
					dataUrl: att.url,
				};
			});

			const localImageResults: FileAttachment[] = localImageItems.map((att) => ({
				kind: 'localImage',
				id: attachmentDedupKey(att),
				name: att.name || basenameFromPath(att.path),
				path: att.path,
			}));

			setInput(draft.text);
			setSelectedSkill(nextSkill);
			setSelectedPrompt(nextPrompt);
			setFileAttachments([...((fileResults.filter(Boolean) as FileAttachment[]) ?? []), ...imageResults, ...localImageResults]);
			setTimeout(() => textareaRef.current?.focus(), 0);
			return true;
		},
		[
			effectiveCwd,
			activeTurnId,
			listSessions,
			normalizeRerunAttachments,
			prompts,
			resolveTurnIdForEntry,
			runningThreadIds,
			selectedThreadId,
			selectSession,
			skills,
			turnOrder,
		]
	);

	const openRerunDialog = useCallback((entry: Extract<ChatEntry, { kind: 'user' }>) => {
		setRerunDialog({ entry });
	}, []);

	const closeRerunDialog = useCallback(() => {
		setRerunDialog(null);
	}, []);

	const submitRerunDialog = useCallback(async () => {
		if (!rerunDialog) return;
		const ok = await requestUserEntryRerun(rerunDialog.entry, {
			text: rerunDialog.entry.text,
			attachments: rerunDialog.entry.attachments ?? [],
		});
		if (ok) setRerunDialog(null);
	}, [rerunDialog, requestUserEntryRerun]);

	const approve = useCallback(async (requestId: number, decision: 'accept' | 'decline') => {
		await apiClient.codexRespondApproval(requestId, decision);
	}, []);

	const toggleEntryCollapse = useCallback(
		(entryId: string) => {
			setCollapsedByEntryId((prev) => {
				const current = prev[entryId] ?? settings.defaultCollapseDetails;
				return { ...prev, [entryId]: !current };
			});
		},
		[settings.defaultCollapseDetails]
	);

	const toggleTurnWorking = useCallback(
		(turnId: string) => {
			skipAutoScrollRef.current = true;
			const turn = turnsById[turnId];
			setCollapsedWorkingByTurnId((prev) => {
				const collapsedExplicit = prev[turnId];
				const currentOpen = collapsedExplicit === undefined ? turn?.status === 'inProgress' : !collapsedExplicit;
				const nextOpen = !currentOpen;
				const nextCollapsedExplicit = !nextOpen;
				return { ...prev, [turnId]: nextCollapsedExplicit };
			});
		},
		[turnsById]
	);

	// Context management callbacks
	const addRelatedRepoDir = useCallback(async () => {
		if (!selectedThreadId) return;
		const currentRepoPath = effectiveCwd;
		if (!currentRepoPath) return;

		const selection = await openDialog({ directory: true, multiple: false });
		const selectedPath = Array.isArray(selection) ? selection[0] : selection;
		if (typeof selectedPath !== 'string' || selectedPath.length === 0) return;

		setRelatedRepoPaths((prev) => {
			if (prev.length >= 3) return prev;
			if (selectedPath === currentRepoPath) return prev;
			if (prev.includes(selectedPath)) return prev;
			const next = [...prev, selectedPath];
			relatedRepoPathsByThreadIdRef.current[selectedThreadId] = next;
			return next;
		});
	}, [effectiveCwd, selectedThreadId]);

	const removeRelatedRepoDir = useCallback(
		(path: string) => {
			if (!selectedThreadId) return;
			setRelatedRepoPaths((prev) => {
				const next = prev.filter((p) => p !== path);
				relatedRepoPathsByThreadIdRef.current[selectedThreadId] = next;
				return next;
			});
		},
		[selectedThreadId]
	);

	const toggleWorktreeMenu = useCallback(() => {
		setIsWorktreeMenuOpen((prev) => {
			const next = !prev;
			if (next) {
				setWorktreeActionError(null);
				void loadWorktrees();
				void loadBranches();
			}
			return next;
		});
	}, [loadBranches, loadWorktrees]);

	const closeWorktreeMenu = useCallback(() => {
		setIsWorktreeMenuOpen(false);
	}, []);

	const selectWorktree = useCallback((path: string) => {
		setActiveWorktreePath(path);
		setIsWorktreeMenuOpen(false);
		setWorktreeActionError(null);
	}, []);

	const createWorktree = useCallback(async () => {
		if (!effectiveCwd) return;
		if (!newWorktreeBranch) {
			setWorktreeActionError('请选择一个分支');
			return;
		}
		if (!newWorktreeName.trim()) {
			setWorktreeActionError('请输入 worktree 名称');
			return;
		}
		setWorktreeCreating(true);
		setWorktreeActionError(null);
		try {
			const path = await apiClient.gitWorktreeCreate(effectiveCwd, newWorktreeName.trim(), newWorktreeBranch);
			setActiveWorktreePath(path);
			setNewWorktreeName('');
			setIsWorktreeMenuOpen(false);
			await loadWorktrees(path);
		} catch (err) {
			setWorktreeActionError(errorMessage(err, 'Failed to create worktree'));
		} finally {
			setWorktreeCreating(false);
		}
	}, [effectiveCwd, loadWorktrees, newWorktreeBranch, newWorktreeName]);

	const loadAutoContext = useCallback(async () => {
		if (!autoContextEnabled) {
			setAutoContext(null);
			return;
		}
		try {
			const cwd = effectiveCwd;
			if (!cwd) {
				setAutoContext(null);
				return;
			}
			const ctx = await apiClient.getAutoContext(cwd);
			setAutoContext(ctx);
		} catch {
			setAutoContext(null);
		}
	}, [autoContextEnabled, effectiveCwd]);

	const searchFiles = useCallback(
		async (query: string) => {
			setFileSearchQuery(query);
			if (!query.trim()) {
				setFileSearchResults([]);
				return;
			}
			try {
				const cwd = effectiveCwd ?? '.';
				const results = await apiClient.searchWorkspaceFiles(cwd, query, 8);
				setFileSearchResults(results);
			} catch {
				setFileSearchResults([]);
			}
		},
		[effectiveCwd]
	);

	const addFileAttachment = useCallback(
		async (file: FileInfo) => {
			try {
				const cwd = effectiveCwd ?? '.';
				const fullPath = file.path.startsWith('/') ? file.path : `${cwd}/${file.path}`;
				const content = await apiClient.readFileContent(fullPath);
				setFileAttachments((prev) => {
					if (prev.some((f) => f.kind === 'file' && f.path === file.path)) return prev;
					return [
						...prev,
						{
							kind: 'file',
							id: file.path,
							path: file.path,
							name: file.name,
							content,
						},
					];
				});
				setIsAddContextOpen(false);
				setFileSearchQuery('');
				setFileSearchResults([]);
			} catch {
				// ignore
			}
		},
		[effectiveCwd]
	);

	const removeFileAttachment = useCallback((id: string) => {
		setFileAttachments((prev) => prev.filter((f) => f.id !== id));
	}, []);

	const addImagesFromFiles = useCallback(async (files: File[]) => {
		if (files.length === 0) return;

		const skipped: string[] = [];
		const additions: FileAttachment[] = [];

		const readAsDataUrl = (file: File) =>
			new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result ?? ''));
				reader.onerror = () => reject(new Error('read failed'));
				reader.readAsDataURL(file);
			});

		for (const file of files) {
			if (!file) continue;
			if (!file.type?.startsWith('image/')) continue;
			if (file.size > MAX_IMAGE_BYTES) {
				skipped.push(file.name || 'image');
				continue;
			}
			try {
				const dataUrl = await readAsDataUrl(file);
				if (!isImageDataUrl(dataUrl)) {
					skipped.push(file.name || 'image');
					continue;
				}
				const id = `image:${file.name}:${file.size}:${file.lastModified}`;
				additions.push({
					kind: 'image',
					id,
					name: file.name || guessImageNameFromDataUrl(dataUrl),
					sizeBytes: file.size,
					mimeType: file.type || 'image/*',
					dataUrl,
				});
			} catch {
				skipped.push(file.name || 'image');
			}
		}

		if (additions.length > 0) {
			setFileAttachments((prev) => {
				const seen = new Set(prev.map((att) => att.id));
				const next = [...prev];
				for (const att of additions) {
					if (seen.has(att.id)) continue;
					seen.add(att.id);
					next.push(att);
				}
				return next;
			});
		}

		if (skipped.length > 0) {
			const list = skipped
				.slice(0, 8)
				.map((n) => `- ${n}`)
				.join('\n');
			const more = skipped.length > 8 ? `\n... 以及另外 ${skipped.length - 8} 个` : '';
			await dialogMessage(`以下图片未添加（仅支持 image/* 且单张最大 5MB）：\n${list}${more}`, { title: '图片上传', kind: 'warning' });
		}
	}, []);

	const handleImageUpload = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(e.target.files ?? []);
			if (files.length === 0) return;
			void addImagesFromFiles(files);
			setIsAddContextOpen(false);
			if (fileInputRef.current) fileInputRef.current.value = '';
		},
		[addImagesFromFiles]
	);

	const handleTextareaPaste = useCallback(
		(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
			const items = Array.from(e.clipboardData?.items ?? []);
			const files: File[] = [];
			for (const item of items) {
				if (item.kind !== 'file') continue;
				const file = item.getAsFile();
				if (file) files.push(file);
			}
			if (files.length > 0) {
				void addImagesFromFiles(files);
			}
		},
		[addImagesFromFiles]
	);

	const filteredSlashCommands: FilteredSlashCommand[] = useMemo(() => {
		// 去掉前导斜杠和空白
		const query = slashSearchQuery.trim().replace(/^\/+/, '');
		if (!query) {
			return SLASH_COMMANDS.map((cmd) => ({ cmd, indices: null, score: 0 }));
		}

		const results: FilteredSlashCommand[] = [];

		for (const cmd of SLASH_COMMANDS) {
			// 匹配 id 或 label
			const matchLabel = fuzzyMatch(query, cmd.label);
			const matchId = fuzzyMatch(query, cmd.id);

			// 优先使用 label 匹配（也是实际展示的字段），避免高亮索引错位。
			if (matchLabel) {
				results.push({ cmd, indices: matchLabel.indices, score: matchLabel.score });
				continue;
			}
			// id 仅用于兜底检索：展示时不高亮 label，且排序略靠后。
			if (matchId) {
				results.push({ cmd, indices: null, score: matchId.score + 10_000 });
			}
		}

		// 按分数排序（分数越小越好）
		return results.sort((a, b) => a.score - b.score);
	}, [slashSearchQuery]);

	// Skills filtered for slash menu (using slashSearchQuery)
	const filteredSkillsForSlashMenu: FilteredSkill[] = useMemo(() => {
		const query = slashSearchQuery.trim().replace(/^\/+/, '');
		if (!query) {
			return skills.map((skill) => ({ skill, indices: null, score: 0 }));
		}

		const results: FilteredSkill[] = [];

		for (const skill of skills) {
			const matchName = fuzzyMatch(query, skill.name);
			if (!matchName) continue;
			results.push({ skill, indices: matchName.indices, score: matchName.score });
		}

		return results.sort((a, b) => a.score - b.score);
	}, [slashSearchQuery, skills]);

	// Prompts filtered for slash menu (using slashSearchQuery)
	type FilteredPrompt = {
		prompt: CustomPrompt;
		indices: number[] | null;
		score: number;
	};

	const filteredPromptsForSlashMenu: FilteredPrompt[] = useMemo(() => {
		const query = slashSearchQuery.trim().replace(/^\/+/, '');
		if (!query) {
			return prompts.map((prompt) => ({ prompt, indices: null, score: 0 }));
		}

		const PROMPT_PREFIX = 'prompts:';
		const normalizedQuery = query.toLowerCase().startsWith(PROMPT_PREFIX) ? query.slice(PROMPT_PREFIX.length) : query;
		if (!normalizedQuery.trim()) {
			return prompts.map((prompt) => ({ prompt, indices: null, score: 0 }));
		}

		const results: FilteredPrompt[] = [];

		for (const prompt of prompts) {
			// 仅匹配 prompt.name（不匹配 description），展示时仍以 "prompts:name" 形式显示。
			const matchName = fuzzyMatch(normalizedQuery, prompt.name);
			if (!matchName) continue;
			results.push({
				prompt,
				indices: matchName.indices.map((idx) => idx + PROMPT_PREFIX.length),
				score: matchName.score,
			});
		}

		return results.sort((a, b) => a.score - b.score);
	}, [slashSearchQuery, prompts]);

	// Total items count for slash menu (commands + prompts + skills)
	const slashMenuTotalItems = filteredSlashCommands.length + filteredPromptsForSlashMenu.length + filteredSkillsForSlashMenu.length;

	// Filtered skills with fuzzy matching
	type FilteredSkill = {
		skill: SkillMetadata;
		indices: number[] | null;
		score: number;
	};

	const filteredSkills: FilteredSkill[] = useMemo(() => {
		const query = skillSearchQuery.trim();
		if (!query) {
			return skills.map((skill) => ({ skill, indices: null, score: 0 }));
		}

		const results: FilteredSkill[] = [];

		for (const skill of skills) {
			const matchName = fuzzyMatch(query, skill.name);
			if (!matchName) continue;
			results.push({ skill, indices: matchName.indices, score: matchName.score });
		}

		return results.sort((a, b) => a.score - b.score);
	}, [skillSearchQuery, skills]);

	// Execute skill selection - display as tag in input area (no text insertion)
	const executeSkillSelection = useCallback((skill: SkillMetadata) => {
		setIsSkillMenuOpen(false);
		setIsSlashMenuOpen(false);
		setSkillSearchQuery('');
		setSlashSearchQuery('');
		setSkillHighlightIndex(0);
		setSlashHighlightIndex(0);
		setSelectedSkill(skill);

		// Focus back to textarea
		setTimeout(() => textareaRef.current?.focus(), 0);
	}, []);

	// Execute prompt selection - display as tag in input area (no text insertion)
	const executePromptSelection = useCallback((prompt: CustomPrompt) => {
		setIsSlashMenuOpen(false);
		setIsSkillMenuOpen(false);
		setSlashSearchQuery('');
		setSkillSearchQuery('');
		setSlashHighlightIndex(0);
		setSkillHighlightIndex(0);
		setSelectedPrompt(prompt);

		// Focus back to textarea
		setTimeout(() => textareaRef.current?.focus(), 0);
	}, []);

	const executeSlashCommand = useCallback(
		(cmdId: string) => {
			setIsSlashMenuOpen(false);
			setSlashSearchQuery('');
			setSlashHighlightIndex(0);

			// 辅助函数：添加系统消息
			const addSystemMessage = (text: string, tone: 'info' | 'warning' | 'error' = 'info') => {
				const entry: ChatEntry = {
					kind: 'system',
					id: `system-${cmdId}-${crypto.randomUUID()}`,
					tone,
					text,
				};
				setTurnOrder((prev) => (prev.includes(PENDING_TURN_ID) ? prev : [...prev, PENDING_TURN_ID]));
				setTurnsById((prev) => {
					const existing = prev[PENDING_TURN_ID] ?? {
						id: PENDING_TURN_ID,
						status: 'unknown' as const,
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
			};

			switch (cmdId) {
				// === TUI2 命令 ===
				case 'model':
					setOpenStatusPopover('model');
					break;
				case 'approvals':
					setOpenStatusPopover('approval_policy');
					break;
				case 'skills':
					// 打开 skills 菜单
					setIsSkillMenuOpen(true);
					setSkillSearchQuery('');
					setSkillHighlightIndex(0);
					break;
				case 'review':
					setInput('/review ');
					textareaRef.current?.focus();
					break;
				case 'new':
					void createNewSession();
					break;
				case 'resume':
					setIsSessionTreeExpanded(true);
					break;
				case 'init':
					setInput('/init');
					textareaRef.current?.focus();
					break;
				case 'compact':
					setInput('/compact');
					textareaRef.current?.focus();
					break;
				case 'diff':
					setInput('/diff');
					textareaRef.current?.focus();
					break;
				case 'mention':
					setIsAddContextOpen(true);
					break;
				case 'status': {
					const tokenInfo = threadTokenUsage
						? `Tokens: ${formatTokenCount(threadTokenUsage.totalTokens)}${threadTokenUsage.contextWindow ? ` / ${formatTokenCount(threadTokenUsage.contextWindow)}` : ''}`
						: 'Tokens: —';
					const statusText = [
						`Thread: ${selectedThreadId ?? 'none'}`,
						`Model: ${selectedModel ?? 'default'}`,
						`Effort: ${selectedEffort ?? 'default'}`,
						`Approval: ${approvalPolicy}`,
						tokenInfo,
						`Auto context: ${autoContextEnabled ? 'enabled' : 'disabled'}`,
					].join('\n');
					addSystemMessage(statusText);
					break;
				}
				case 'mcp':
					setInput('/mcp');
					textareaRef.current?.focus();
					break;
				case 'logout':
					addSystemMessage('Logout 功能暂未实现', 'warning');
					break;
				case 'quit':
					// 尝试关闭窗口
					window.close();
					break;
				case 'feedback':
					window.open('https://github.com/anthropics/claude-code/issues', '_blank');
					break;
				// === GUI 特有命令 ===
				case 'clear':
					setTurnOrder([]);
					setTurnsById({});
					setCollapsedWorkingByTurnId({});
					setCollapsedByEntryId({});
					break;
				case 'context':
					setAutoContextEnabled((v) => !v);
					break;
			}
		},
		[approvalPolicy, autoContextEnabled, createNewSession, selectedEffort, selectedModel, selectedThreadId, threadTokenUsage]
	);

	const handleTextareaKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			// Skill menu navigation
			if (isSkillMenuOpen) {
				if (e.key === 'ArrowDown') {
					e.preventDefault();
					setSkillHighlightIndex((i) => Math.min(i + 1, filteredSkills.length - 1));
					return;
				}
				if (e.key === 'ArrowUp') {
					e.preventDefault();
					setSkillHighlightIndex((i) => Math.max(i - 1, 0));
					return;
				}
				// Tab 键补全
				if (e.key === 'Tab') {
					e.preventDefault();
					const selected = filteredSkills[skillHighlightIndex];
					if (selected) {
						executeSkillSelection(selected.skill);
					}
					return;
				}
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					const selected = filteredSkills[skillHighlightIndex];
					if (selected) executeSkillSelection(selected.skill);
					return;
				}
				if (e.key === 'Escape') {
					e.preventDefault();
					setIsSkillMenuOpen(false);
					setSkillSearchQuery('');
					return;
				}
			}

			// Slash menu navigation (commands + prompts + skills)
			if (isSlashMenuOpen) {
				if (e.key === 'ArrowDown') {
					e.preventDefault();
					setSlashHighlightIndex((i) => Math.min(i + 1, slashMenuTotalItems - 1));
					return;
				}
				if (e.key === 'ArrowUp') {
					e.preventDefault();
					setSlashHighlightIndex((i) => Math.max(i - 1, 0));
					return;
				}
				// Tab 键补全
				if (e.key === 'Tab') {
					e.preventDefault();
					if (slashHighlightIndex < filteredSlashCommands.length) {
						const selected = filteredSlashCommands[slashHighlightIndex];
						if (selected) {
							setInput(`/${selected.cmd.id} `);
							setIsSlashMenuOpen(false);
							setSlashSearchQuery('');
						}
					} else if (slashHighlightIndex < filteredSlashCommands.length + filteredPromptsForSlashMenu.length) {
						const promptIdx = slashHighlightIndex - filteredSlashCommands.length;
						const selected = filteredPromptsForSlashMenu[promptIdx];
						if (selected) {
							executePromptSelection(selected.prompt);
						}
					} else {
						const skillIdx = slashHighlightIndex - filteredSlashCommands.length - filteredPromptsForSlashMenu.length;
						const selected = filteredSkillsForSlashMenu[skillIdx];
						if (selected) {
							executeSkillSelection(selected.skill);
						}
					}
					return;
				}
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					if (slashHighlightIndex < filteredSlashCommands.length) {
						const selected = filteredSlashCommands[slashHighlightIndex];
						if (selected) executeSlashCommand(selected.cmd.id);
					} else if (slashHighlightIndex < filteredSlashCommands.length + filteredPromptsForSlashMenu.length) {
						const promptIdx = slashHighlightIndex - filteredSlashCommands.length;
						const selected = filteredPromptsForSlashMenu[promptIdx];
						if (selected) {
							executePromptSelection(selected.prompt);
						}
					} else {
						const skillIdx = slashHighlightIndex - filteredSlashCommands.length - filteredPromptsForSlashMenu.length;
						const selected = filteredSkillsForSlashMenu[skillIdx];
						if (selected) {
							executeSkillSelection(selected.skill);
						}
					}
					return;
				}
				if (e.key === 'Escape') {
					e.preventDefault();
					setIsSlashMenuOpen(false);
					return;
				}
			}

			// Backspace 删除已选中的 prompt/skill（像删除文本一样）
			if (e.key === 'Backspace') {
				const target = e.target as HTMLTextAreaElement;
				const cursorPos = target.selectionStart ?? 0;
				const cursorEnd = target.selectionEnd ?? 0;
				if (cursorPos === 0 && cursorEnd === 0) {
					if (selectedSkill) {
						e.preventDefault();
						setSelectedSkill(null);
						return;
					}
					if (selectedPrompt) {
						e.preventDefault();
						setSelectedPrompt(null);
						return;
					}
				}
			}

			// Open slash menu when typing / (隐藏 / 字符，直接打开搜索框)
			if (e.key === '/') {
				const target = e.target as HTMLTextAreaElement;
				const cursorPos = target.selectionStart ?? 0;
				const textBeforeCursor = input.slice(0, cursorPos);
				// 只在行首或空白后输入 / 时触发
				if (cursorPos === 0 || /\s$/.test(textBeforeCursor)) {
					e.preventDefault(); // 阻止 / 字符出现在输入框中
					setIsSlashMenuOpen(true);
					setSlashHighlightIndex(0);
					setSlashSearchQuery('');
				}
			}

			// Open skill menu when typing $ (隐藏 $ 字符，直接打开搜索框)
			if (e.key === '$') {
				const target = e.target as HTMLTextAreaElement;
				const cursorPos = target.selectionStart ?? 0;
				const textBeforeCursor = input.slice(0, cursorPos);
				// 只在行首或空白后输入 $ 时触发
				if (cursorPos === 0 || /\s$/.test(textBeforeCursor)) {
					e.preventDefault(); // 阻止 $ 字符出现在输入框中
					setIsSkillMenuOpen(true);
					setSkillHighlightIndex(0);
					setSkillSearchQuery('');
				}
			}

			// Send message
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				void sendMessage();
			}
		},
		[
			executeSlashCommand,
			executeSkillSelection,
			executePromptSelection,
			filteredSlashCommands,
			filteredSkills,
			filteredPromptsForSlashMenu,
			filteredSkillsForSlashMenu,
			input,
			isSlashMenuOpen,
			isSkillMenuOpen,
			selectedPrompt,
			selectedSkill,
			sendMessage,
			slashHighlightIndex,
			skillHighlightIndex,
			slashMenuTotalItems,
		]
	);

	// Auto-scroll menu list to keep highlighted item visible
	useLayoutEffect(() => {
		if (!menuListRef.current) return;
		const container = menuListRef.current;
		const highlightedItem = container.querySelector('[data-highlighted="true"]') as HTMLElement | null;
		if (highlightedItem) {
			highlightedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}, [slashHighlightIndex, skillHighlightIndex, isSlashMenuOpen, isSkillMenuOpen]);

	// Load auto context when enabled or thread changes
	useEffect(() => {
		void loadAutoContext();
	}, [loadAutoContext]);

	useEffect(() => {
		void loadWorktrees();
		void loadBranches();
	}, [loadBranches, loadWorktrees]);

	useEffect(() => {
		listSessions();
		void seedRunningThreads();
		loadModelsAndChatDefaults();
		void loadWorkspaceRoot();
		void loadRecentWorkspaces();
		void loadSkills();
		void loadPrompts();
	}, [listSessions, seedRunningThreads, loadModelsAndChatDefaults, loadWorkspaceRoot, loadRecentWorkspaces, loadSkills, loadPrompts]);

	useEffect(() => {
		externalRefreshPendingRef.current = null;
	}, [selectedThreadId]);

	useEffect(() => {
		const seq = ++threadWatchSeqRef.current;
		const threadId = selectedThreadId;
		const path = activeThread?.path ?? null;
		void (async () => {
			try {
				await apiClient.codexThreadWatchStop();
			} catch {
				// ignore
			}
			if (seq !== threadWatchSeqRef.current) return;
			if (threadId && path) {
				try {
					await apiClient.codexThreadWatchStart(threadId, path);
				} catch {
					// ignore
				}
			}
		})();
		return () => {
			if (seq === threadWatchSeqRef.current) {
				void apiClient.codexThreadWatchStop().catch(() => {
					// ignore
				});
			}
		};
	}, [activeThread?.path, selectedThreadId]);

	useEffect(() => {
		let mounted = true;
		const unlistenPromise = listen<CodexThreadWatchEvent>('codex_thread_fs_update', (event) => {
			if (!mounted) return;
			const payload = event.payload;
			if (!payload || typeof payload !== 'object') return;
			if (!selectedThreadId || payload.threadId !== selectedThreadId) return;

			const { ok, updatedAtMs } = shouldApplyExternalRefresh(payload.threadId, payload.updatedAtMs);
			if (!ok || updatedAtMs == null) return;
			if (activeTurnId) {
				externalRefreshPendingRef.current = { threadId: payload.threadId, updatedAtMs };
				return;
			}
			void refreshSelectedThread(payload.threadId, updatedAtMs);
		});

		return () => {
			mounted = false;
			unlistenPromise
				.then((unlisten) => unlisten())
				.catch(() => {
					// ignore
				});
		};
	}, [activeTurnId, refreshSelectedThread, selectedThreadId, shouldApplyExternalRefresh]);

	useEffect(() => {
		if (activeTurnId) return;
		const pending = externalRefreshPendingRef.current;
		if (!pending) return;
		externalRefreshPendingRef.current = null;
		void refreshSelectedThread(pending.threadId, pending.updatedAtMs, { allowStale: true });
	}, [activeTurnId, refreshSelectedThread]);

	useCodexJsonRpcEvents({
		selectedThreadId,
		activeTurnId,
		defaultCollapseDetails: settings.defaultCollapseDetails,
		itemToTurnRef,
		setItemToTurnId,
		setThreadRunning,
		ingestCollabItems,
		setThreadTokenUsage,
		setActiveTurnId,
		setTurnOrder,
		setTurnsById,
		setCollapsedByEntryId,
	});

	const selectedModelInfo = useMemo(() => {
		if (!selectedModel) return null;
		return models.find((m) => m.model === selectedModel) ?? null;
	}, [models, selectedModel]);

	const contextUsageLabel = useMemo(() => {
		if (!threadTokenUsage) return '—';
		const used = threadTokenUsage.totalTokens;
		const window = threadTokenUsage.contextWindow;
		if (!window || !Number.isFinite(window) || window <= 0) return `${formatTokenCount(used)}`;
		const pct = Math.min(999, Math.max(0, Math.round((used / window) * 100)));
		return `${pct}%`;
	}, [threadTokenUsage]);

	const effortOptions = useMemo(() => {
		return selectedModelInfo?.supportedReasoningEfforts ?? [];
	}, [selectedModelInfo]);

	const activePanelTab = useMemo(() => {
		if (!activeMainTabId) return null;
		return panelTabs.find((tab) => tab.id === activeMainTabId) ?? null;
	}, [activeMainTabId, panelTabs]);

	const activeFileTab = activePanelTab?.kind === 'file' ? activePanelTab : null;
	const activeAgentTab = activePanelTab?.kind === 'agent' ? activePanelTab : null;

	// Ensure the currently visible agent tab is actually loaded into the chat timeline state.
	useEffect(() => {
		if (!activeAgentTab?.threadId) return;
		if (selectedThreadId === activeAgentTab.threadId) return;
		setSelectedSessionTreeNodeOverride(null);
		void selectSession(activeAgentTab.threadId);
	}, [activeAgentTab?.threadId, selectSession, selectedThreadId]);

	const [turnAppearById, setTurnAppearById] = useState<Record<string, boolean>>({});
	const awaitingTurnAppearBaselineRef = useRef(true);
	const lastTurnOrderIdentityRef = useRef<string[] | null>(null);
	const turnAppearBaselineRef = useRef<Set<string>>(new Set());
	const turnAppearTimersRef = useRef<Record<string, number>>({});

	useEffect(() => {
		// When switching threads, wait for the first turnOrder update before animating.
		awaitingTurnAppearBaselineRef.current = true;
		turnAppearBaselineRef.current = new Set();
		setTurnAppearById({});
		for (const timer of Object.values(turnAppearTimersRef.current)) {
			window.clearTimeout(timer);
		}
		turnAppearTimersRef.current = {};
	}, [selectedThreadId]);

	useEffect(() => {
		return () => {
			for (const timer of Object.values(turnAppearTimersRef.current)) {
				window.clearTimeout(timer);
			}
		};
	}, []);

	useEffect(() => {
		if (!selectedThreadId) return;

		// Detect "real" turn list changes by identity, so we don't prime baseline on thread switch
		// before the new thread's timeline has been loaded.
		const turnOrderChanged = lastTurnOrderIdentityRef.current !== turnOrder;
		lastTurnOrderIdentityRef.current = turnOrder;

		if (awaitingTurnAppearBaselineRef.current) {
			if (!turnOrderChanged) return;
			turnAppearBaselineRef.current = new Set(turnOrder);
			awaitingTurnAppearBaselineRef.current = false;
			return;
		}

		const prev = turnAppearBaselineRef.current;
		const newTurnIds = turnOrder.filter((id) => !prev.has(id));
		turnAppearBaselineRef.current = new Set(turnOrder);
		if (newTurnIds.length === 0) return;

		setTurnAppearById((prevMap) => {
			const out = { ...prevMap };
			for (const id of newTurnIds) out[id] = true;
			return out;
		});

		for (const id of newTurnIds) {
			const existing = turnAppearTimersRef.current[id];
			if (existing) window.clearTimeout(existing);
			turnAppearTimersRef.current[id] = window.setTimeout(() => {
				setTurnAppearById((prevMap) => {
					if (!(id in prevMap)) return prevMap;
					const out = { ...prevMap };
					delete out[id];
					return out;
				});
				delete turnAppearTimersRef.current[id];
			}, TURN_APPEAR_ANIM_MS);
		}
	}, [selectedThreadId, turnOrder]);

	const scrollRef = useRef<HTMLDivElement>(null);
	const turnBlocks = useMemo(() => {
		const out: TurnBlockData[] = [];
		for (const id of turnOrder) {
			const turn = turnsById[id];
			if (turn) out.push(turn);
		}
		return out;
	}, [turnOrder, turnsById]);

	const renderTurns = useMemo<TurnBlockView[]>(() => {
		return buildTurnBlockViews(turnBlocks, settings.showReasoning);
	}, [settings.showReasoning, turnBlocks]);

	const renderCount = useMemo(() => {
		return renderTurns.reduce((acc, t) => {
			const collapsedExplicit = collapsedWorkingByTurnId[t.id];
			const workingOpen = collapsedExplicit === undefined ? t.status === 'inProgress' : !collapsedExplicit;
			const hasWorking = t.workingItemCount > 0;
			const workingHeaderCount = hasWorking ? 1 : 0;
			const workingDetailsCount = hasWorking && workingOpen ? t.workingRenderCount : 0;
			return acc + t.userEntries.length + workingHeaderCount + workingDetailsCount + t.assistantMessageEntries.length;
		}, 0);
	}, [collapsedWorkingByTurnId, renderTurns]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		if (skipAutoScrollRef.current) {
			skipAutoScrollRef.current = false;
			return;
		}
		el.scrollTop = el.scrollHeight;
	}, [renderCount]);

	return (
		<div className="flex h-full min-w-0 flex-col overflow-x-hidden">
			{/* 自定义标题栏 */}
			<CodexChatHeader
				activeThreadCwd={activeThread?.cwd ?? null}
				workspaceRoot={workspaceRoot}
				recentWorkspaces={recentWorkspaces}
				isWorkspaceMenuOpen={isWorkspaceMenuOpen}
				setIsWorkspaceMenuOpen={setIsWorkspaceMenuOpen}
				isSettingsMenuOpen={isSettingsMenuOpen}
				setIsSettingsMenuOpen={setIsSettingsMenuOpen}
				relatedRepoPaths={relatedRepoPaths}
				selectedThreadId={selectedThreadId}
				canAddRelatedRepoDir={relatedRepoPaths.length < 3}
				onAddRelatedRepoDir={() => void addRelatedRepoDir()}
				onRemoveRelatedRepoDir={removeRelatedRepoDir}
				openNewWindow={() => void openNewWindow()}
				openWorkspaceDialog={() => void openWorkspaceDialog()}
				applyWorkspaceRoot={(path) => void applyWorkspaceRoot(path)}
				showAbout={() => void showAbout()}
				showUpdates={() => void showUpdates()}
				openSettings={() => setIsSettingsOpen(true)}
				openConfig={() => void openConfig()}
			/>

			{/* 主内容区域 */}
			<div className="flex min-h-0 min-w-0 flex-1">
				<SessionTreeSidebar
					isExpanded={isSessionTreeExpanded}
					onExpandedChange={setIsSessionTreeExpanded}
					workspaceLabel={sessionTree.rootLabel}
					treeData={sessionTree.treeData}
					widthPx={sessionTreeWidthPx}
					minWidthPx={SESSION_TREE_MIN_WIDTH_PX}
					maxWidthPx={SESSION_TREE_MAX_WIDTH_PX}
					onWidthChange={handleSessionTreeWidthChange}
					expandedNodes={sessionTreeExpandedNodes}
					selectedNodeId={selectedSessionTreeNodeId}
					onToggleExpand={toggleSessionTreeNode}
					onSelectNode={handleSessionTreeSelect}
					onContextMenu={handleSessionTreeContextMenu}
					onNodeAction={(node, actionId) => {
						if (actionId !== 'archive-group') return;
						const groupKey = sessionTree.archivedGroupKeyByNodeId[node.id];
						if (!groupKey) return;
						void archiveArchivedGroup(groupKey);
					}}
					onCreateNewSession={() => void createNewSession()}
					onRefresh={listSessions}
					loading={sessionsLoading}
					error={sessionsError}
				/>

				{taskContextMenu
					? (() => {
							const menuWidth = 188;
							const menuHeight = 72;
							const x = typeof window !== 'undefined' ? Math.min(taskContextMenu.x, Math.max(8, window.innerWidth - menuWidth - 8)) : taskContextMenu.x;
							const y = typeof window !== 'undefined' ? Math.min(taskContextMenu.y, Math.max(8, window.innerHeight - menuHeight - 8)) : taskContextMenu.y;

							return (
								<div
									className="fixed z-50 w-[188px] rounded-md border border-white/10 bg-bg-popover p-1 text-[11px] text-text-main shadow-lg"
									style={{ left: x, top: y }}
									onMouseDown={(e) => e.stopPropagation()}
									onContextMenu={(e) => {
										e.preventDefault();
										e.stopPropagation();
									}}
								>
									<button
										type="button"
										className="flex w-full items-center rounded px-2 py-1.5 hover:bg-white/5"
										onClick={() => {
											const threadId = taskContextMenu.threadId;
											closeTaskContextMenu();
											void renameTaskThread(threadId);
										}}
									>
										Rename…
									</button>
									<button
										type="button"
										className="flex w-full items-center rounded px-2 py-1.5 text-status-error hover:bg-status-error/10"
										onClick={() => {
											const nodeId = taskContextMenu.nodeId;
											closeTaskContextMenu();
											void archiveTaskNode(nodeId);
										}}
									>
										Delete (Archive)
									</button>
								</div>
							);
						})()
					: null}

				{panelTabContextMenu
					? (() => {
							const menuWidth = 188;
							const menuHeight = 40;
							const x = typeof window !== 'undefined' ? Math.min(panelTabContextMenu.x, Math.max(8, window.innerWidth - menuWidth - 8)) : panelTabContextMenu.x;
							const y =
								typeof window !== 'undefined' ? Math.min(panelTabContextMenu.y, Math.max(8, window.innerHeight - menuHeight - 8)) : panelTabContextMenu.y;

							const tab = panelTabs.find((t) => t.id === panelTabContextMenu.tabId) ?? null;
							if (!tab) return null;
							const canRename = tab.kind === 'agent' || (tab.kind === 'file' && !tab.path.startsWith('/'));

							return (
								<div
									className="fixed z-50 w-[188px] rounded-md border border-white/10 bg-bg-popover p-1 text-[11px] text-text-main shadow-lg"
									style={{ left: x, top: y }}
									onMouseDown={(e) => e.stopPropagation()}
									onContextMenu={(e) => {
										e.preventDefault();
										e.stopPropagation();
									}}
								>
									<button
										type="button"
										disabled={!canRename}
										className={['flex w-full items-center rounded px-2 py-1.5', canRename ? 'hover:bg-white/5' : 'cursor-not-allowed opacity-50'].join(' ')}
										onClick={() => {
											if (!canRename) return;
											closePanelTabContextMenu();
											if (tab.kind === 'agent') {
												renameTaskThread(tab.threadId);
												return;
											}
											renameFileTab(tab.id);
										}}
									>
										Rename…
									</button>
								</div>
							);
						})()
					: null}

				{renameTaskDialog ? (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
						onMouseDown={(event) => {
							if (event.target === event.currentTarget) closeRenameTaskDialog();
						}}
					>
						<div className="w-full max-w-sm rounded-xl border border-white/10 bg-bg-popover p-4 text-sm text-text-main">
							<div className="mb-3 flex items-center justify-between gap-2">
								<div className="text-sm font-semibold">Rename task</div>
								<button
									type="button"
									className="rounded-md border border-white/10 bg-bg-panelHover px-2 py-1 text-xs hover:border-white/20"
									onClick={closeRenameTaskDialog}
								>
									✕
								</button>
							</div>

							{renameTaskDialog.error ? (
								<div className="mb-3 rounded-md border border-status-error/30 bg-status-error/10 px-2 py-1 text-xs text-status-error">
									{renameTaskDialog.error}
								</div>
							) : null}

							<input
								ref={renameTaskInputRef}
								className="w-full rounded-md border border-white/10 bg-bg-panelHover px-2 py-1.5 text-xs outline-none focus:border-border-active"
								value={renameTaskDialog.value}
								maxLength={50}
								onChange={(event) => {
									const value = event.target.value;
									setRenameTaskDialog((prev) => (prev ? { ...prev, value, error: null } : prev));
								}}
								onKeyDown={(event) => {
									if (event.key === 'Escape') {
										event.preventDefault();
										closeRenameTaskDialog();
									}
									if (event.key === 'Enter') {
										event.preventDefault();
										void submitRenameTask();
									}
								}}
							/>

							<div className="mt-3 flex justify-end gap-2">
								<button
									type="button"
									className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-1 text-xs hover:border-white/20"
									onClick={closeRenameTaskDialog}
								>
									Cancel
								</button>
								<button
									type="button"
									className="rounded-md border border-primary/40 bg-primary/20 px-3 py-1 text-xs text-text-main hover:bg-primary/30"
									onClick={() => void submitRenameTask()}
								>
									Save
								</button>
							</div>
						</div>
					</div>
				) : null}

				{renameFileDialog ? (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
						onMouseDown={(event) => {
							if (event.target === event.currentTarget) closeRenameFileDialog();
						}}
					>
						<div className="w-full max-w-sm rounded-xl border border-white/10 bg-bg-popover p-4 text-sm text-text-main">
							<div className="mb-3 flex items-center justify-between gap-2">
								<div className="text-sm font-semibold">Rename file</div>
								<button
									type="button"
									className="rounded-md border border-white/10 bg-bg-panelHover px-2 py-1 text-xs hover:border-white/20"
									onClick={closeRenameFileDialog}
								>
									✕
								</button>
							</div>

							<div className="mb-2 truncate text-[11px] text-text-muted">{renameFileDialog.fromPath}</div>

							{renameFileDialog.error ? (
								<div className="mb-3 rounded-md border border-status-error/30 bg-status-error/10 px-2 py-1 text-xs text-status-error">
									{renameFileDialog.error}
								</div>
							) : null}

							<input
								ref={renameFileInputRef}
								className="w-full rounded-md border border-white/10 bg-bg-panelHover px-2 py-1.5 text-xs outline-none focus:border-border-active"
								value={renameFileDialog.value}
								maxLength={255}
								onChange={(event) => {
									const value = event.target.value;
									setRenameFileDialog((prev) => (prev ? { ...prev, value, error: null } : prev));
								}}
								onKeyDown={(event) => {
									if (event.key === 'Escape') {
										event.preventDefault();
										closeRenameFileDialog();
									}
									if (event.key === 'Enter') {
										event.preventDefault();
										void submitRenameFile();
									}
								}}
							/>

							<div className="mt-3 flex justify-end gap-2">
								<button
									type="button"
									className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-1 text-xs hover:border-white/20"
									onClick={closeRenameFileDialog}
								>
									Cancel
								</button>
								<button
									type="button"
									className="rounded-md border border-primary/40 bg-primary/20 px-3 py-1 text-xs text-text-main hover:bg-primary/30"
									onClick={() => void submitRenameFile()}
								>
									Save
								</button>
							</div>
						</div>
					</div>
				) : null}

				{rerunDialog ? (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
						onMouseDown={(event) => {
							if (event.target === event.currentTarget) closeRerunDialog();
						}}
					>
						<div className="w-full max-w-lg rounded-xl border border-white/10 bg-bg-popover p-4 text-sm text-text-main">
							<div className="mb-3 flex items-center justify-between gap-2">
								<div className="text-sm font-semibold">确认重新运行</div>
								<button
									type="button"
									className="rounded-md border border-white/10 bg-bg-panelHover px-2 py-1 text-xs hover:border-white/20"
									onClick={closeRerunDialog}
								>
									✕
								</button>
							</div>

							<div className="text-xs text-text-muted">
								{selectedThreadId && runningThreadIds[selectedThreadId]
									? '当前有回合正在运行。重新运行会中断它，并移除该消息及其之后的所有消息。不会回滚代码改动。'
									: '重新运行会移除该消息及其之后的所有消息。不会回滚代码改动。'}
							</div>

							<div className="mt-3 flex justify-end gap-2">
								<button
									type="button"
									className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-1 text-xs hover:border-white/20"
									onClick={closeRerunDialog}
								>
									取消
								</button>
								<button
									type="button"
									className="rounded-md border border-primary/40 bg-primary/20 px-3 py-1 text-xs text-text-main hover:bg-primary/30"
									onClick={() => void submitRerunDialog()}
								>
									重新运行
								</button>
							</div>
						</div>
					</div>
				) : null}

				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col pb-0.5">
					<div className="flex h-6 items-center justify-between border-b border-white/10 pr-3 py-0">
						<div className="flex min-w-0 items-center overflow-x-auto">
							{panelTabs.map((tab) => {
								const active = tab.id === activeMainTabId;
								const title = tab.kind === 'file' && tab.dirty ? `${tab.title}*` : tab.title;
								return (
									<div
										key={tab.id}
										className={[
											'group inline-flex h-6 max-w-[180px] items-center gap-1.5 border-b-2 px-3 text-[11px] transition-colors',
											active ? 'border-primary bg-bg-panel/60 text-text-main' : 'border-transparent text-text-muted hover:text-text-main',
										].join(' ')}
										onClick={() => {
											setActiveMainTabId(tab.id);
											if (tab.kind === 'agent') {
												setSelectedSessionTreeNodeOverride(null);
												void openAgentPanel(tab.threadId);
											}
										}}
										onContextMenu={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setPanelTabContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
										}}
										role="button"
										tabIndex={0}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												setActiveMainTabId(tab.id);
												if (tab.kind === 'agent') {
													setSelectedSessionTreeNodeOverride(null);
													void openAgentPanel(tab.threadId);
												}
											}
										}}
									>
										<span className="truncate select-none">{title}</span>
										<button
											type="button"
											className="rounded p-0.5 text-text-muted hover:text-text-main"
											onClick={(e) => {
												e.stopPropagation();
												void closePanelTab(tab.id);
											}}
											aria-label={`Close ${tab.title}`}
										>
											<X className="h-3 w-3" />
										</button>
									</div>
								);
							})}
						</div>

						<div className="relative flex shrink-0 items-center">
							<button
								type="button"
								className="am-icon-button h-6 w-6 text-text-muted hover:text-text-main"
								onClick={() => {
									setIsSettingsMenuOpen(false);
									void createNewSession();
								}}
								title="New session"
							>
								<Plus className="h-4 w-4" />
							</button>
						</div>
					</div>

					<div className="relative flex min-h-0 flex-1 flex-col px-4 pt-6">
						{workspaceRootError ? <div className="mt-2 text-xs text-status-warning">{workspaceRootError}</div> : null}
						{workspaceListToast ? (
							<div className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2">
								<div className="max-w-[720px] whitespace-pre-wrap rounded-xl border border-white/10 bg-bg-popover px-3 py-2 text-xs shadow-lg">
									<div className="font-semibold text-status-warning">工作区告警</div>
									<div className="mt-1 text-text-muted">{workspaceListToast}</div>
								</div>
							</div>
						) : null}

						{activeAgentTab ? (
							<>
								<div className="mt-3 min-h-0 flex-1 flex gap-4">
									<CodexChatWorkbenchSidebar
										enabled={isWorkbenchEnabled}
										workbenchGraph={workbenchGraph}
										workbenchAutoFocus={workbenchAutoFocus}
										setWorkbenchAutoFocus={setWorkbenchAutoFocus}
										collabAgentStateByThreadId={collabAgentStateByThreadId}
										runningThreadIds={runningThreadIds}
										selectSession={selectSession}
										forkThreadLatest={forkThreadLatest}
									/>

									<div className="min-h-0 flex-1 flex flex-col min-w-0">
										<CodexChatWorkbenchThreadChips
											enabled={isWorkbenchEnabled}
											workbenchGraph={workbenchGraph}
											selectedThreadId={selectedThreadId}
											selectSession={selectSession}
										/>

										<div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pb-4 min-w-0">
											{renderTurns.map((turn) => (
												<TurnBlock
													key={turn.id}
													animateIn={Boolean(turnAppearById[turn.id])}
													turn={turn}
													collapsedWorkingByTurnId={collapsedWorkingByTurnId}
													collapsedByEntryId={collapsedByEntryId}
													settings={settings}
													pendingTurnId={PENDING_TURN_ID}
													toggleTurnWorking={toggleTurnWorking}
													toggleEntryCollapse={toggleEntryCollapse}
													approve={approve}
													onForkFromTurn={forkFromTurn}
													onEditUserEntry={openRerunDialog}
												/>
											))}
										</div>
										<CodexChatComposer
											pinnedResolvedItems={pinnedResolvedItems}
											executePromptSelection={executePromptSelection}
											executeSkillSelection={executeSkillSelection}
											executeSlashCommand={executeSlashCommand}
											togglePinnedPromptName={togglePinnedPromptName}
											togglePinnedSkillName={togglePinnedSkillName}
											pinnedPromptNames={pinnedPromptNames}
											pinnedSkillNames={pinnedSkillNames}
											isSlashMenuOpen={isSlashMenuOpen}
											isAddContextOpen={isAddContextOpen}
											isSkillMenuOpen={isSkillMenuOpen}
											setIsSlashMenuOpen={setIsSlashMenuOpen}
											setIsAddContextOpen={setIsAddContextOpen}
											setIsSkillMenuOpen={setIsSkillMenuOpen}
											slashSearchQuery={slashSearchQuery}
											skillSearchQuery={skillSearchQuery}
											fileSearchQuery={fileSearchQuery}
											setSlashSearchQuery={setSlashSearchQuery}
											setSkillSearchQuery={setSkillSearchQuery}
											setFileSearchQuery={setFileSearchQuery}
											slashHighlightIndex={slashHighlightIndex}
											skillHighlightIndex={skillHighlightIndex}
											setSlashHighlightIndex={setSlashHighlightIndex}
											setSkillHighlightIndex={setSkillHighlightIndex}
											slashMenuTotalItems={slashMenuTotalItems}
											filteredSlashCommands={filteredSlashCommands}
											filteredPromptsForSlashMenu={filteredPromptsForSlashMenu}
											filteredSkillsForSlashMenu={filteredSkillsForSlashMenu}
											skills={skills}
											filteredSkills={filteredSkills}
											fileSearchResults={fileSearchResults}
											setFileSearchResults={setFileSearchResults}
											searchFiles={searchFiles}
											addFileAttachment={addFileAttachment}
											fileAttachments={fileAttachments}
											removeFileAttachment={removeFileAttachment}
											handleImageUpload={handleImageUpload}
											fileInputRef={fileInputRef}
											selectedPrompt={selectedPrompt}
											selectedSkill={selectedSkill}
											input={input}
											setInput={setInput}
											textareaRef={textareaRef}
											menuListRef={menuListRef}
											handleTextareaPaste={handleTextareaPaste}
											handleTextareaKeyDown={handleTextareaKeyDown}
											sending={sending}
											autoContextEnabled={autoContextEnabled}
											setAutoContextEnabled={setAutoContextEnabled}
											autoContext={autoContext}
											worktreeLabel={activeWorktreeLabel}
											activeWorktreePath={activeWorktreePath}
											worktrees={worktrees}
											worktreesLoading={worktreesLoading}
											worktreesError={worktreesError}
											branches={branches}
											branchesLoading={branchesLoading}
											branchesError={branchesError}
											isWorktreeMenuOpen={isWorktreeMenuOpen}
											toggleWorktreeMenu={toggleWorktreeMenu}
											closeWorktreeMenu={closeWorktreeMenu}
											selectWorktree={selectWorktree}
											newWorktreeName={newWorktreeName}
											setNewWorktreeName={setNewWorktreeName}
											newWorktreeBranch={newWorktreeBranch}
											setNewWorktreeBranch={setNewWorktreeBranch}
											worktreeActionError={worktreeActionError}
											worktreeCreating={worktreeCreating}
											createWorktree={createWorktree}
											activeTurnId={activeTurnId}
											selectedThreadId={selectedThreadId}
											stopTurn={() => {
												if (!selectedThreadId || !activeTurnId) return;
												void apiClient.codexTurnInterrupt(selectedThreadId, activeTurnId);
											}}
											sendMessage={sendMessage}
										/>

										<StatusBar
											openStatusPopover={openStatusPopover}
											setOpenStatusPopover={setOpenStatusPopover}
											clearStatusPopoverError={() => setStatusPopoverError(null)}
											statusPopoverError={statusPopoverError}
											approvalPolicy={approvalPolicy}
											selectedModel={selectedModel}
											selectedModelInfo={selectedModelInfo}
											models={models}
											modelsError={modelsError}
											profiles={profiles}
											selectedProfile={selectedProfile}
											selectedEffort={selectedEffort}
											effortOptions={effortOptions}
											contextUsageLabel={contextUsageLabel}
											applyApprovalPolicy={applyApprovalPolicy}
											applyModel={applyModel}
											applyProfile={applyProfile}
											applyReasoningEffort={applyReasoningEffort}
											isWorkbenchEnabled={isWorkbenchEnabled}
										/>
									</div>
								</div>
							</>
						) : (
							<div className="mt-3 min-h-0 flex-1 overflow-hidden">
								{!activeFileTab ? (
									<div className="rounded-xl border border-white/10 bg-bg-panelHover/40 p-4 text-sm text-text-muted">
										Select a session or file from the left sidebar.
									</div>
								) : (
									<div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-bg-panelHover/40">
										<div className="flex items-start justify-between gap-3 border-b border-white/10 px-3 py-2">
											<div className="min-w-0">
												<div className="truncate text-sm font-semibold">
													{activeFileTab.path}
													{activeFileTab.dirty ? <span className="ml-2 text-xs text-status-warning">unsaved</span> : null}
												</div>
												<div className="mt-1 text-xs text-text-muted">
													{activeFileTab.loading ? 'Loading…' : activeFileTab.saving ? 'Saving…' : activeFileTab.error ? 'Error' : ''}
												</div>
											</div>
											<div className="flex shrink-0 items-center gap-2">
												<button
													type="button"
													className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-text-main hover:border-white/20 disabled:opacity-50"
													onClick={() => void saveFileTab(activeFileTab.id)}
													disabled={activeFileTab.loading || activeFileTab.saving || !activeFileTab.dirty}
													title={activeFileTab.dirty ? 'Save' : 'No changes'}
												>
													Save
												</button>
												<button
													type="button"
													className={['am-icon-button h-7 w-7 text-text-muted hover:text-text-main', activeFileTab.showPreview ? 'bg-white/10' : ''].join(' ')}
													onClick={() => toggleFileTabPreview(activeFileTab.id)}
													title={activeFileTab.showPreview ? 'Hide preview' : 'Show preview'}
												>
													<Eye className="h-4 w-4" />
												</button>
											</div>
										</div>

										{activeFileTab.error ? (
											<div className="m-3 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{activeFileTab.error}</div>
										) : null}

										<div className="min-h-0 flex flex-1">
											<div className={activeFileTab.showPreview ? 'min-h-0 w-1/2 border-r border-white/10 p-3' : 'min-h-0 w-full p-3'}>
												<textarea
													className="h-full min-h-[360px] w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-[12px] text-text-main outline-none focus:border-border-active disabled:opacity-60"
													value={activeFileTab.draft}
													onChange={(e) => setFileTabDraft(activeFileTab.id, e.target.value)}
													spellCheck={false}
													disabled={activeFileTab.loading || activeFileTab.saving}
												/>
											</div>

											{activeFileTab.showPreview ? (
												<div className="min-h-0 w-1/2 overflow-y-auto p-3">{renderTextPreview(activeFileTab.draft, activeFileTab.path)}</div>
											) : null}
										</div>
									</div>
								)}
							</div>
						)}

						{isConfigOpen ? (
							<div className="fixed inset-0 z-50 flex">
								<div className="flex-1 bg-black/60" onClick={() => setIsConfigOpen(false)} role="button" tabIndex={0} />
								<div className="w-[520px] max-w-[90vw] border-l border-white/10 bg-bg-popover p-6">
									<div className="mb-4 flex items-start justify-between gap-3">
										<div>
											<div className="text-sm font-semibold">~/.codex/config.toml</div>
											<div className="mt-1 text-xs text-text-muted">Edit Codex configuration directly. Changes apply to future turns.</div>
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
										<div className="mb-3 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{configError}</div>
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
											{configSaving ? 'Saving…' : 'Save'}
										</button>
									</div>
								</div>
							</div>
						) : null}

						{isSettingsOpen ? (
							<div className="fixed inset-0 z-50 flex">
								<div className="flex-1 bg-black/60" onClick={() => setIsSettingsOpen(false)} role="button" tabIndex={0} />
								<div className="w-[520px] max-w-[92vw] border-l border-white/10 bg-bg-popover p-6">
									<div className="mb-4 flex items-start justify-between gap-3">
										<div>
											<div className="text-sm font-semibold">Chat Settings</div>
											<div className="mt-1 text-xs text-text-muted">Affects rendering only; no protocol changes.</div>
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
												<div className="mt-1 text-xs text-text-muted">Display Thought/Reasoning items in the timeline.</div>
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
												<div className="text-sm font-semibold">Default collapse details</div>
												<div className="mt-1 text-xs text-text-muted">When enabled, command output & diffs start collapsed (you can always expand).</div>
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
													<div className="text-sm font-semibold">Codex diagnostics</div>
													<div className="mt-1 text-xs text-text-muted">
														If you see “codex not found on PATH”, this shows the PATH that the app-server spawn uses.
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

											{diagnosticsError ? <div className="mt-2 text-xs text-status-warning">{diagnosticsError}</div> : null}

											{diagnostics ? (
												<div className="mt-3 space-y-2 text-[11px] text-text-muted">
													<div className="truncate">
														{diagnostics.resolvedCodexBin ? `resolved codex: ${diagnostics.resolvedCodexBin}` : 'resolved codex: (not found)'}
													</div>
													<div className="truncate">{diagnostics.envOverride ? `COCO_CODEX_BIN: ${diagnostics.envOverride}` : 'COCO_CODEX_BIN: (unset)'}</div>
													<div className="truncate">
														PATH source: {diagnostics.pathSource ?? '(unknown)'}
														{diagnostics.shell ? ` · shell: ${diagnostics.shell}` : ''}
													</div>
													<div className="truncate">
														env source: {diagnostics.envSource ?? '(unknown)'}
														{typeof diagnostics.envCount === 'number' ? ` · vars: ${diagnostics.envCount}` : ''}
													</div>
													<div className="break-all rounded-lg bg-black/20 p-2">
														<div className="mb-1 text-text-dim">PATH</div>
														{diagnostics.path}
													</div>
												</div>
											) : (
												<div className="mt-3 text-xs text-text-muted">
													Tip: set <span className="font-mono">COCO_CODEX_BIN</span> to an absolute path (e.g.{' '}
													<span className="font-mono">/opt/homebrew/bin/codex</span>) if launching from Finder.
												</div>
											)}
										</div>
									</div>
								</div>
							</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}

export default CodexChat;
