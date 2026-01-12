import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { message as dialogMessage, open as openDialog } from '@tauri-apps/plugin-dialog';
import {
	ArrowUp,
	AtSign,
	Box,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	Cpu,
	File,
	FilePlus,
	FileText,
	Folder,
	GitBranch,
	Image,
	Info,
	LogOut,
	Menu,
	Minimize2,
	Paperclip,
	Play,
	Plus,
	RotateCw,
	Search,
	Settings,
	Shield,
	SignalHigh,
	SignalLow,
	SignalMedium,
	SignalZero,
	Slash,
	Trash2,
	Users,
	Wrench,
	X,
	Zap,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import type {
	AutoContextInfo,
	CodexJsonRpcEvent,
	CodexModelInfo,
	CodexThread,
	CodexThreadItem,
	CodexThreadSummary,
	CodexUserInput,
	CustomPrompt,
	FileAttachment,
	FileInfo,
	ReasoningEffort,
	SkillMetadata,
} from '../types/codex';

// 附加内容类型
type AttachmentItem =
	| { type: 'file'; path: string; name: string }
	| { type: 'skill'; name: string }
	| { type: 'prompt'; name: string };

type ChatEntry =
	| {
			kind: 'user';
			id: string;
			text: string;
			attachments?: AttachmentItem[];
	  }
	| {
			kind: 'assistant';
			id: string;
			text: string;
			role: 'message' | 'reasoning';
			streaming?: boolean;
	  }
	| {
			kind: 'command';
			id: string;
			command: string;
			status: string;
			cwd?: string;
			output?: string | null;
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
			changes: Array<{ path: string; diff?: string }>;
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
			kind: 'mcp';
			id: string;
			server: string;
			tool: string;
			status: string;
			message?: string;
	  }
	| {
			kind: 'system';
			id: string;
			text: string;
			tone?: 'info' | 'warning' | 'error';
	  };

type CodexChatSettings = {
	showReasoning: boolean;
	defaultCollapseDetails: boolean;
};

const SETTINGS_STORAGE_KEY = 'agentmesh.codexChat.settings.v1';
const SIDEBAR_WIDTH_PX = 48 * 0.7;
const SIDEBAR_ICON_BUTTON_PX = SIDEBAR_WIDTH_PX * 0.7;

function loadCodexChatSettings(): CodexChatSettings {
	const defaults: CodexChatSettings = {
		showReasoning: false,
		defaultCollapseDetails: false,
	};

	if (typeof window === 'undefined') return defaults;
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

function markdownWithHardBreaks(text: string): string {
	if (!text) return '';
	const lines = text.split('\n');
	let inFence = false;
	const out: string[] = [];
	for (const line of lines) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith('```')) {
			inFence = !inFence;
			out.push(line);
			continue;
		}
		// Mimic remark-breaks (single newline -> <br>) without pulling extra deps:
		// add trailing "  " so markdown treats newline as a hard break.
		out.push(inFence ? line : `${line}  `);
	}
	return out.join('\n');
}

function ChatMarkdown({
	text,
	className,
	dense = false,
}: {
	text: string;
	className?: string;
	dense?: boolean;
}) {
	const normalized = useMemo(() => markdownWithHardBreaks(text), [text]);
	const leadingClass = dense ? 'leading-normal' : 'leading-relaxed';
	const paragraphClass = dense
		? 'my-0.5 whitespace-pre-wrap break-words'
		: 'my-1 whitespace-pre-wrap break-words';
	const listClass = dense ? 'my-0.5' : 'my-1';
	const preClass = dense ? 'my-1.5' : 'my-2';

	return (
		<div
			className={[
				'min-w-0',
				// Align with VSCode plugin: remove first list top margin.
				'[&>ol:first-child]:mt-0 [&>ul:first-child]:mt-0 [&>p:first-child]:mt-0',
				`break-words ${leadingClass}`,
				className ?? '',
			].join(' ')}
		>
			<ReactMarkdown
				components={{
					p: ({ children }) => <p className={paragraphClass}>{children}</p>,
					ul: ({ children }) => <ul className={`${listClass} list-disc pl-5`}>{children}</ul>,
					ol: ({ children }) => <ol className={`${listClass} list-decimal pl-5`}>{children}</ol>,
					li: ({ children }) => <li className="my-0.5">{children}</li>,
					pre: ({ children }) => (
						<pre
							className={`${preClass} overflow-x-auto rounded-lg bg-black/30 px-3 py-2 text-[11px] leading-relaxed text-text-muted`}
						>
							{children}
						</pre>
					),
					code: ({ className, children }) => {
						const isBlock = typeof className === 'string' && className.includes('language-');
						return !isBlock ? (
							<code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px] text-text-main">
								{children}
							</code>
						) : (
							<code className="font-mono text-[11px] text-text-muted">{children}</code>
						);
					},
					a: ({ href, children }) => (
						<a
							href={href}
							className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
							target="_blank"
							rel="noreferrer"
						>
							{children}
						</a>
					),
				}}
			>
				{normalized}
			</ReactMarkdown>
		</div>
	);
}

function isCollapsibleEntry(
	entry: ChatEntry
): entry is Extract<ChatEntry, { kind: 'command' | 'fileChange' | 'webSearch' | 'mcp' }> {
	return (
		entry.kind === 'command' ||
		entry.kind === 'fileChange' ||
		entry.kind === 'webSearch' ||
		entry.kind === 'mcp'
	);
}

type AnsiTextStyle = {
	fgClass?: string;
	bgClass?: string;
	bold?: boolean;
	dim?: boolean;
	underline?: boolean;
};

function ansiColorClass(code: number): string | undefined {
	// Basic 16-color-ish mapping (focus on common git colors: red/green/yellow).
	switch (code) {
		// Normal
		case 30:
			return 'text-black';
		case 31:
			return 'text-red-400';
		case 32:
			return 'text-green-400';
		case 33:
			return 'text-yellow-400';
		case 34:
			return 'text-blue-400';
		case 35:
			return 'text-fuchsia-400';
		case 36:
			return 'text-cyan-400';
		case 37:
			return 'text-text-main';
		// Bright
		case 90:
			return 'text-zinc-500';
		case 91:
			return 'text-red-400';
		case 92:
			return 'text-green-400';
		case 93:
			return 'text-yellow-400';
		case 94:
			return 'text-sky-400';
		case 95:
			return 'text-fuchsia-300';
		case 96:
			return 'text-cyan-300';
		case 97:
			return 'text-zinc-100';
		default:
			return undefined;
	}
}

function ansiBgClass(code: number): string | undefined {
	// Keep conservative: only a handful of backgrounds.
	switch (code) {
		case 40:
			return 'bg-black';
		case 41:
			return 'bg-red-600/30';
		case 42:
			return 'bg-green-600/30';
		case 43:
			return 'bg-yellow-600/30';
		case 44:
			return 'bg-blue-600/30';
		case 45:
			return 'bg-fuchsia-600/30';
		case 46:
			return 'bg-cyan-600/30';
		case 47:
			return 'bg-white/10';
		default:
			return undefined;
	}
}

function renderAnsiText(text: string): React.ReactNode {
	// Parse SGR sequences like: \x1b[32m ... \x1b[0m
	const parts: React.ReactNode[] = [];
	const re = /\x1b\[([0-9;]*)m/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	let style: AnsiTextStyle = {};
	let segmentKey = 0;

	const pushText = (chunk: string) => {
		if (!chunk) return;
		const classNames = [
			style.fgClass,
			style.bgClass,
			style.bold ? 'font-semibold' : undefined,
			style.dim ? 'opacity-70' : undefined,
			style.underline ? 'underline' : undefined,
		]
			.filter(Boolean)
			.join(' ');

		if (!classNames) {
			parts.push(chunk);
			return;
		}

		parts.push(
			<span key={`ansi-${segmentKey++}`} className={classNames}>
				{chunk}
			</span>
		);
	};

	while ((match = re.exec(text)) !== null) {
		const idx = match.index;
		if (idx > lastIndex) pushText(text.slice(lastIndex, idx));

		const codesRaw = match[1] ?? '';
		const codes = codesRaw
			.split(';')
			.filter((c) => c.length > 0)
			.map((c) => Number(c))
			.filter((n) => Number.isFinite(n));

		// Empty code list means reset in many terminals.
		const effectiveCodes = codes.length === 0 ? [0] : codes;
		for (const code of effectiveCodes) {
			if (code === 0) {
				style = {};
				continue;
			}
			if (code === 1) {
				style.bold = true;
				continue;
			}
			if (code === 2) {
				style.dim = true;
				continue;
			}
			if (code === 4) {
				style.underline = true;
				continue;
			}
			if (code === 22) {
				style.bold = false;
				style.dim = false;
				continue;
			}
			if (code === 24) {
				style.underline = false;
				continue;
			}
			if (code === 39) {
				style.fgClass = undefined;
				continue;
			}
			if (code === 49) {
				style.bgClass = undefined;
				continue;
			}

			if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
				style.fgClass = ansiColorClass(code);
				continue;
			}
			if (code >= 40 && code <= 47) {
				style.bgClass = ansiBgClass(code);
				continue;
			}
			if (code >= 100 && code <= 107) {
				// Bright backgrounds - approximate
				style.bgClass = 'bg-white/10';
				continue;
			}
		}

		lastIndex = re.lastIndex;
	}

	if (lastIndex < text.length) pushText(text.slice(lastIndex));
	return parts.length === 1 ? parts[0] : parts;
}

// 通用 Activity Block 组件
interface ActivityBlockProps {
	/** 标题前缀，如 "Ran", "Edited" */
	titlePrefix: string;
	/** 标题主要内容 */
	titleContent: string;
	/** 标题是否使用等宽字体 */
	titleMono?: boolean;
	/** 状态文本 */
	status?: string;
	/** 复制内容 */
	copyContent: string;
	/** 是否可折叠 */
	collapsible?: boolean;
	/** 是否已折叠 */
	collapsed?: boolean;
	/** 切换折叠状态 */
	onToggleCollapse?: () => void;
	/** 内容区域 */
	children?: React.ReactNode;
	/** 审批信息 */
	approval?: {
		requestId: number;
		reason?: string | null;
	};
	/** 审批回调 */
	onApprove?: (requestId: number, decision: 'accept' | 'decline') => void;
}

function ActivityBlock({
	titlePrefix,
	titleContent,
	titleMono = false,
	status,
	copyContent,
	collapsible = false,
	collapsed = true,
	onToggleCollapse,
	children,
	approval,
	onApprove,
}: ActivityBlockProps) {
	const contentNode =
		typeof children === 'string' ? renderAnsiText(children) : children;
	const showStatus = status && status !== 'completed';

	return (
		<div className="min-w-0">
			{/* 标题栏 */}
			<div
				className={[
					'group flex min-w-0 items-center justify-between gap-2 py-1',
					collapsible && onToggleCollapse ? 'cursor-pointer' : '',
				].join(' ')}
				role={collapsible && onToggleCollapse ? 'button' : undefined}
				tabIndex={collapsible && onToggleCollapse ? 0 : undefined}
				onClick={() => {
					if (collapsible && onToggleCollapse) onToggleCollapse();
				}}
				onKeyDown={(e) => {
					if (!collapsible || !onToggleCollapse) return;
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onToggleCollapse();
					}
				}}
			>
				<div className="min-w-0 flex-1 truncate text-xs text-text-main">
					<span className="text-text-dim">{titlePrefix} </span>
					<span className={titleMono ? 'font-mono' : ''}>{titleContent}</span>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{showStatus ? <span className="text-[10px] text-text-muted">{status}</span> : null}
					<button
						type="button"
						className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-text-main group-hover:opacity-100"
						title="复制内容"
						onClick={(ev) => {
							ev.stopPropagation();
							void navigator.clipboard.writeText(copyContent);
						}}
					>
						<Copy className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
			{/* 内容区域 */}
			{children && (!collapsible || !collapsed) ? (
				<div className="mt-1 pl-3">
					<div className="max-h-[200px] overflow-auto pr-2">
						<div className="min-w-max whitespace-pre font-mono text-[11px] text-text-muted">
							{contentNode}
						</div>
					</div>
				</div>
			) : null}
			{/* 审批区域 */}
			{approval && onApprove ? (
				<div className="mt-1 flex items-center justify-between gap-3 px-3 py-2">
					<div className="min-w-0 text-xs text-text-muted">
						Approval required
						{approval.reason ? `: ${approval.reason}` : ''}.
					</div>
					<div className="flex shrink-0 gap-2">
						<button
							type="button"
							className="rounded-md bg-status-success/20 px-3 py-1 text-xs font-semibold text-status-success"
							onClick={() => onApprove(approval.requestId, 'accept')}
						>
							批准
						</button>
						<button
							type="button"
							className="rounded-md bg-status-error/15 px-3 py-1 text-xs font-semibold text-status-error"
							onClick={() => onApprove(approval.requestId, 'decline')}
						>
							拒绝
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}

type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';

function repoNameFromPath(path: string): string {
	const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
	const parts = normalized.split('/').filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : path;
}

function wrapUserInputWithRepoContext(options: {
	userInput: string;
	currentRepoPath: string | null;
	relatedRepoPaths: string[];
}): string {
	const lines: string[] = ['# Context from my IDE setup:', ''];
	if (options.currentRepoPath) {
		lines.push(`## Current repo: ${options.currentRepoPath}`);
	}
	for (const path of options.relatedRepoPaths) {
		lines.push(`## Related repo: ${path}`);
	}
	lines.push('', '## My request for Codex:', options.userInput);
	return lines.join('\n');
}

function reasoningEffortLabelEn(effort: ReasoningEffort): string {
	switch (effort) {
		case 'none':
			return 'None';
		case 'minimal':
			return 'Minimal';
		case 'low':
			return 'Low';
		case 'medium':
			return 'Medium';
		case 'high':
			return 'High';
		case 'xhigh':
			return 'Extra high';
		default:
			return effort;
	}
}

function translateReasoningDesc(desc: string): string {
	// 翻译 Codex API 返回的原始英文描述
	const translations: Record<string, string> = {
		// Low
		'Fast responses with lighter reasoning': '快速响应，轻量推理',
		'Fastest responses with limited reasoning': '最快响应，有限推理',
		'Balances speed with some reasoning; useful for straightforward queries and short explanations':
			'平衡速度与推理；适合简单查询和简短解释',
		// Medium
		'Balances speed and reasoning depth for everyday tasks': '平衡速度与推理深度，适合日常任务',
		'Dynamically adjusts reasoning based on the task': '根据任务动态调整推理深度',
		'Provides a solid balance of reasoning depth and latency for general-purpose tasks':
			'为通用任务提供推理深度与延迟的良好平衡',
		// High
		'Greater reasoning depth for complex problems': '更深的推理深度，适合复杂问题',
		'Maximizes reasoning depth for complex or ambiguous problems': '最大化推理深度，适合复杂或模糊问题',
		// XHigh
		'Extra high reasoning depth for complex problems': '超高推理深度，适合复杂问题',
		// Minimal
		'Fastest responses with little reasoning': '最快响应，几乎不进行推理',
	};
	return translations[desc] || desc;
}

function translateModelDesc(desc: string): string {
	// 翻译模型描述
	const translations: Record<string, string> = {
		// GPT models
		'Most capable GPT model for complex tasks': '最强大的 GPT 模型，适合复杂任务',
		'Fast and efficient for everyday tasks': '快速高效，适合日常任务',
		'Optimized for code generation and understanding': '针对代码生成和理解优化',
		'Compact model for quick responses': '紧凑模型，快速响应',
		'Mini model optimized for Codex tasks': '针对 Codex 任务优化的迷你模型',
		// Claude models
		'Most capable Claude model': '最强大的 Claude 模型',
		'Balanced performance and speed': '性能与速度平衡',
		'Fast and cost-effective': '快速且经济',
		// Generic descriptions
		'Default model': '默认模型',
		'Latest model version': '最新模型版本',
	};
	return translations[desc] || desc;
}

function parseApprovalPolicyValue(value: unknown): ApprovalPolicy | null {
	if (value === 'untrusted' || value === 'on-failure' || value === 'on-request' || value === 'never') return value;
	return null;
}

function parseReasoningEffortValue(value: unknown): ReasoningEffort | null {
	if (
		value === 'none' ||
		value === 'minimal' ||
		value === 'low' ||
		value === 'medium' ||
		value === 'high' ||
		value === 'xhigh'
	) {
		return value;
	}
	return null;
}

function formatTokenCount(value: number): string {
	if (!Number.isFinite(value)) return '—';
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\\.0$/, '')}m`;
	if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\\.0$/, '')}k`;
	return String(Math.round(value));
}

function statusBarItemClass(active: boolean): string {
	return [
		'inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-border-menuDivider bg-bg-panel/30 px-2 text-[11px] transition-colors',
		active ? 'bg-bg-panelHover text-text-main' : 'text-text-muted hover:bg-bg-panelHover hover:text-text-main',
	].join(' ');
}

// 公共样式配置
const MENU_STYLES = {
	// 弹出菜单容器
	popover: 'rounded-xl border border-border-menu bg-bg-menu/95 shadow-menu backdrop-blur ring-1 ring-border-menuInner',
	// 弹出菜单标题
	popoverTitle: 'px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-menuLabel',
	// 弹出菜单选项
	popoverItem:
		'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-text-main hover:bg-bg-menuItemHover transition-colors group',
	// 弹出菜单选项（高亮/聚焦）- 与 hover 样式一致
	popoverItemActive:
		'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] bg-bg-menuItemHover text-text-main transition-colors group',
	// 弹出菜单选项描述 - 单行截断，名称后空两格
	popoverItemDesc: 'ml-4 shrink-0 max-w-[200px] truncate text-[10px] text-text-menuDesc',
	// 图标尺寸
	iconSm: 'h-4 w-4',
	iconMd: 'h-4 w-4',
	// 搜索输入框
	searchInput: 'w-full bg-transparent text-[12px] text-text-muted outline-none placeholder:text-text-menuDesc',
	// 弹出菜单位置（输入框上方全宽）
	popoverPosition: 'absolute bottom-full left-0 right-0 z-50 mb-2 p-2',
	// 列表容器
	listContainer: 'max-h-[240px] overflow-auto',
};

function reasoningEffortIcon(effort: ReasoningEffort, className = 'h-3 w-3'): JSX.Element {
	switch (effort) {
		case 'none':
		case 'minimal':
			return <SignalZero className={className} />;
		case 'low':
			return <SignalLow className={className} />;
		case 'medium':
			return <SignalMedium className={className} />;
		case 'high':
			return <SignalHigh className={className} />;
		case 'xhigh':
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
	if (typeof err === 'string') return err || fallback;
	try {
		return JSON.stringify(err);
	} catch {
		return fallback;
	}
}

function safeString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function countEntryKinds(entries: ChatEntry[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entry of entries) {
		counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
	}
	return counts;
}

function isCodexTextInput(value: CodexUserInput): value is Extract<CodexUserInput, { type: 'text' }> {
	return value.type === 'text' && typeof (value as { text?: unknown }).text === 'string';
}

function extractUserText(item: Extract<CodexThreadItem, { type: 'userMessage' }>): string {
	const parts = item.content.filter(isCodexTextInput).map((c) => c.text);
	return parts.join('\n').trim();
}

function entryFromThreadItem(item: CodexThreadItem): ChatEntry | null {
	const rawType = safeString((item as unknown as { type?: unknown })?.type);
	// Backend payloads may use different naming conventions; normalize for compatibility.
	const typeKey = rawType.replace(/[-_]/g, '').toLowerCase();

	switch (typeKey) {
		case 'usermessage': {
			const it = item as Extract<CodexThreadItem, { type: 'userMessage' }>;
			return { kind: 'user', id: it.id, text: extractUserText(it) };
		}
		case 'agentmessage': {
			const it = item as Extract<CodexThreadItem, { type: 'agentMessage' }>;
			return {
				kind: 'assistant',
				id: it.id,
				role: 'message',
				text: it.text,
			};
		}
		case 'reasoning': {
			const it = item as Extract<CodexThreadItem, { type: 'reasoning' }>;
			return {
				kind: 'assistant',
				id: it.id,
				role: 'reasoning',
				text: [...(it.summary ?? []), ...(it.content ?? [])].filter(Boolean).join('\n'),
			};
		}
		case 'commandexecution': {
			const it = item as Extract<CodexThreadItem, { type: 'commandExecution' }>;
			return {
				kind: 'command',
				id: it.id,
				command: it.command,
				status: it.status,
				cwd: it.cwd,
				output: it.aggregatedOutput ?? null,
			};
		}
		case 'filechange': {
			const it = item as Extract<CodexThreadItem, { type: 'fileChange' }>;
			return {
				kind: 'fileChange',
				id: it.id,
				status: it.status,
				changes: it.changes.map((c) => ({ path: c.path, diff: c.diff })),
			};
		}
		case 'websearch': {
			const it = item as Extract<CodexThreadItem, { type: 'webSearch' }>;
			return { kind: 'webSearch', id: it.id, query: it.query };
		}
		case 'mcptoolcall': {
			const it = item as Extract<CodexThreadItem, { type: 'mcpToolCall' }>;
			return {
				kind: 'mcp',
				id: it.id,
				server: it.server,
				tool: it.tool,
				status: it.status,
				message: it.error?.message ?? undefined,
			};
		}
		default: {
			if (typeof window !== 'undefined' && rawType) {
				// eslint-disable-next-line no-console
				console.debug('[CodexChat] Unknown thread item type:', rawType, item);
			}
			return null;
		}
	}
}

function mergeEntry(entries: ChatEntry[], next: ChatEntry): ChatEntry[] {
	const idx = entries.findIndex((e) => e.id === next.id && e.kind === next.kind);
	if (idx === -1) return [...entries, next];
	const copy = [...entries];
	copy[idx] = { ...copy[idx], ...next } as ChatEntry;
	return copy;
}

function appendDelta(entries: ChatEntry[], id: string, role: 'message' | 'reasoning', delta: string): ChatEntry[] {
	const idx = entries.findIndex((e) => e.kind === 'assistant' && e.id === id && e.role === role);
	if (idx === -1) {
		return [...entries, { kind: 'assistant', id, role, text: delta, streaming: true }];
	}
	const copy = [...entries];
	const existing = copy[idx] as Extract<ChatEntry, { kind: 'assistant' }>;
	copy[idx] = {
		...existing,
		text: `${existing.text}${delta}`,
		streaming: true,
	};
	return copy;
}

function formatSessionUpdatedAtMs(session: CodexThreadSummary): string {
	const updated = session.updatedAtMs ? new Date(session.updatedAtMs).toLocaleString() : '—';
	return updated;
}

function normalizeThreadFromResponse(res: unknown): CodexThread | null {
	if (!res || typeof res !== 'object') return null;
	const obj = res as Record<string, unknown>;
	const thread = obj.thread;
	if (!thread || typeof thread !== 'object') return null;
	return thread as CodexThread;
}

type TurnBlockStatus = 'inProgress' | 'completed' | 'failed' | 'interrupted' | 'unknown';

type TurnBlock = {
	id: string;
	status: TurnBlockStatus;
	entries: ChatEntry[];
};

const PENDING_TURN_ID = '__pending__';

function isActivityEntry(
	entry: ChatEntry
): entry is Extract<ChatEntry, { kind: 'command' | 'fileChange' | 'mcp' | 'webSearch' }> {
	return entry.kind === 'command' || entry.kind === 'fileChange' || entry.kind === 'mcp' || entry.kind === 'webSearch';
}

function parseTurnStatus(value: unknown): TurnBlockStatus {
	if (typeof value !== 'string') return 'unknown';
	if (value === 'inProgress') return 'inProgress';
	if (value === 'completed') return 'completed';
	if (value === 'failed') return 'failed';
	if (value === 'interrupted') return 'interrupted';
	return 'unknown';
}

function turnStatusLabel(status: TurnBlockStatus): string {
	switch (status) {
		case 'inProgress':
			return 'Working…';
		case 'completed':
			return 'Finished working';
		case 'failed':
			return 'Failed';
		case 'interrupted':
			return 'Interrupted';
		default:
			return 'Turn';
	}
}

// Slash Commands definition
type SlashCommandIcon =
	| 'cpu'
	| 'shield'
	| 'zap'
	| 'search'
	| 'plus'
	| 'play'
	| 'file-plus'
	| 'minimize'
	| 'git-branch'
	| 'at-sign'
	| 'info'
	| 'tool'
	| 'log-out'
	| 'x'
	| 'message'
	| 'trash'
	| 'paperclip';

type SlashCommand = {
	id: string;
	label: string;
	description: string;
	icon: SlashCommandIcon;
};

// 命令顺序与 TUI2 保持一致（高频命令优先）
const SLASH_COMMANDS: SlashCommand[] = [
	{ id: 'model', label: 'Model', description: '选择模型和推理强度', icon: 'cpu' },
	{ id: 'approvals', label: 'Approvals', description: '设置无需批准的操作', icon: 'shield' },
	{ id: 'skills', label: 'Skills', description: '使用技能改进任务执行', icon: 'zap' },
	{ id: 'review', label: 'Review', description: '审查当前更改并查找问题', icon: 'search' },
	{ id: 'new', label: 'New', description: '开始新会话', icon: 'plus' },
	{ id: 'resume', label: 'Resume', description: '恢复已保存的会话', icon: 'play' },
	{ id: 'init', label: 'Init', description: '创建 AGENTS.md 文件', icon: 'file-plus' },
	{ id: 'compact', label: 'Compact', description: '总结对话以防止达到上下文限制', icon: 'minimize' },
	{ id: 'diff', label: 'Diff', description: '显示 git diff（包括未跟踪文件）', icon: 'git-branch' },
	{ id: 'mention', label: 'Mention', description: '提及文件', icon: 'at-sign' },
	{ id: 'status', label: 'Status', description: '显示当前会话配置和 token 使用情况', icon: 'info' },
	{ id: 'mcp', label: 'MCP', description: '列出配置的 MCP 工具', icon: 'tool' },
	{ id: 'logout', label: 'Logout', description: '登出', icon: 'log-out' },
	{ id: 'quit', label: 'Quit', description: '退出', icon: 'x' },
	{ id: 'feedback', label: 'Feedback', description: '发送反馈', icon: 'message' },
	// GUI 特有命令
	{ id: 'clear', label: 'Clear', description: '清空当前对话', icon: 'trash' },
	{ id: 'context', label: 'Auto context', description: '切换 Auto context', icon: 'paperclip' },
];

/**
 * 模糊匹配算法 - 子序列匹配，返回匹配索引和分数（分数越小越好）
 * 移植自 TUI2 的 fuzzy_match.rs
 */
function fuzzyMatch(haystack: string, needle: string): { indices: number[]; score: number } | null {
	if (!needle) return { indices: [], score: Number.MAX_SAFE_INTEGER };

	const haystackLower = haystack.toLowerCase();
	const needleLower = needle.toLowerCase();

	const indices: number[] = [];
	let cur = 0;

	for (const nc of needleLower) {
		let found = false;
		while (cur < haystackLower.length) {
			if (haystackLower[cur] === nc) {
				indices.push(cur);
				cur++;
				found = true;
				break;
			}
			cur++;
		}
		if (!found) return null;
	}

	if (indices.length === 0) return { indices: [], score: 0 };

	const firstPos = indices[0];
	const lastPos = indices[indices.length - 1];
	const window = lastPos - firstPos + 1 - needleLower.length;
	let score = Math.max(0, window);

	// 前缀匹配奖励
	if (firstPos === 0) score -= 100;

	return { indices, score };
}

type FilteredSlashCommand = {
	cmd: SlashCommand;
	indices: number[] | null;
	score: number;
};

/**
 * 高亮匹配的字符
 */
function highlightMatches(text: string, indices: number[]): React.ReactNode {
	if (!indices || indices.length === 0) return text;

	const result: React.ReactNode[] = [];
	let lastIdx = 0;

	for (const idx of indices) {
		if (idx > lastIdx) {
			result.push(text.slice(lastIdx, idx));
		}
		result.push(
			<span key={idx} className="text-primary font-semibold">
				{text[idx]}
			</span>
		);
		lastIdx = idx + 1;
	}

	if (lastIdx < text.length) {
		result.push(text.slice(lastIdx));
	}

	return result;
}

export function CodexChat() {
	const [settings, setSettings] = useState<CodexChatSettings>(() => loadCodexChatSettings());
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
	const [collapsedRepliesByTurnId, setCollapsedRepliesByTurnId] = useState<Record<string, boolean>>({});
	const [_itemToTurnId, setItemToTurnId] = useState<Record<string, string>>({});
	const [collapsedByEntryId, setCollapsedByEntryId] = useState<Record<string, boolean>>({});
	const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

	const [input, setInput] = useState('');
	const [sending, setSending] = useState(false);

	const [selectedModel, setSelectedModel] = useState<string | null>(null);
	const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort | null>(null);
	const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>('untrusted');
	const [openStatusPopover, setOpenStatusPopover] = useState<
		'profile' | 'approval_policy' | 'model' | 'model_reasoning_effort' | null
	>(null);
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
	const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
	const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
	const itemToTurnRef = useRef<Record<string, string>>({});
	const relatedRepoPathsByThreadIdRef = useRef<Record<string, string[]>>({});
	const skipAutoScrollRef = useRef(false);

	// Context management state
	const [autoContext, setAutoContext] = useState<AutoContextInfo | null>(null);
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
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const menuListRef = useRef<HTMLDivElement>(null);

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

	useEffect(() => {
		persistCodexChatSettings(settings);
	}, [settings]);

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

	const listSessions = useCallback(async () => {
		setSessionsLoading(true);
		setSessionsError(null);
		try {
			const res = await apiClient.codexThreadList(null, 200);
			setSessions(res.data);
		} catch (err) {
			setSessionsError(errorMessage(err, 'Failed to list sessions'));
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
			const configuredModel = typeof config.model === 'string' ? config.model : null;
			const configuredEffort = parseReasoningEffortValue(config.model_reasoning_effort);
			const configuredApproval = parseApprovalPolicyValue(config.approval_policy);

			if (configuredApproval) setApprovalPolicy(configuredApproval);

			const fallbackModel = nextModels.find((m) => m.isDefault) ?? nextModels[0] ?? null;
			const modelToUse =
				configuredModel && nextModels.some((m) => m.model === configuredModel)
					? configuredModel
					: fallbackModel?.model ?? null;
			setSelectedModel(modelToUse);

			const modelInfo = modelToUse ? nextModels.find((m) => m.model === modelToUse) ?? null : null;
			const supportedEfforts = modelInfo?.supportedReasoningEfforts?.map((o) => o.reasoningEffort) ?? [];
			const effortToUse =
				configuredEffort && supportedEfforts.includes(configuredEffort)
					? configuredEffort
					: modelInfo?.defaultReasoningEffort ?? null;
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
				await apiClient.codexConfigWriteChatDefaults({ approvalPolicy: next });
			} catch (err) {
				setApprovalPolicy(prev);
				setStatusPopoverError(errorMessage(err, 'Failed to update approval_policy'));
			}
		},
		[approvalPolicy]
	);

	const applyModel = useCallback(
		async (nextModel: string) => {
			if (nextModel === selectedModel) return;
			setStatusPopoverError(null);

			const prevModel = selectedModel;
			const prevEffort = selectedEffort;

			const modelInfo = models.find((m) => m.model === nextModel) ?? null;
			const supportedEfforts = modelInfo?.supportedReasoningEfforts?.map((o) => o.reasoningEffort) ?? [];
			const nextEffort =
				selectedEffort && supportedEfforts.includes(selectedEffort)
					? selectedEffort
					: modelInfo?.defaultReasoningEffort ?? null;

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
				setStatusPopoverError(errorMessage(err, 'Failed to update model'));
			}
		},
		[models, selectedEffort, selectedModel]
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
				setStatusPopoverError(errorMessage(err, 'Failed to update model_reasoning_effort'));
			}
		},
		[selectedEffort]
	);

	const selectSession = useCallback(
		async (threadId: string) => {
			setSelectedThreadId(threadId);
			setTurnOrder([]);
			setTurnsById({});
			setThreadTokenUsage(null);
			setCollapsedRepliesByTurnId({});
			setCollapsedByEntryId({});
			setItemToTurnId({});
			itemToTurnRef.current = {};
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

				const nextOrder: string[] = [];
				const nextTurns: Record<string, TurnBlock> = {};
				const nextEntryCollapse: Record<string, boolean> = {};
				const nextItemToTurn: Record<string, string> = {};
				const nextRepliesCollapsed: Record<string, boolean> = {};
				const typeCounts: Record<string, number> = {};

				for (const turn of thread.turns ?? []) {
					const turnId = turn.id;
					if (!turnId) continue;
					nextOrder.push(turnId);
					nextRepliesCollapsed[turnId] = true;

					const turnEntries: ChatEntry[] = [];
					for (const item of turn.items ?? []) {
						const rawType = safeString((item as unknown as { type?: unknown })?.type);
						if (rawType) typeCounts[rawType] = (typeCounts[rawType] ?? 0) + 1;

						const entry = entryFromThreadItem(item);
						if (!entry) continue;
						turnEntries.push(entry);
						nextItemToTurn[entry.id] = turnId;
						if (isCollapsibleEntry(entry)) nextEntryCollapse[entry.id] = settings.defaultCollapseDetails;
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
					nextRepliesCollapsed[turnId] = true;
					nextTurns[turnId] = { id: turnId, status: 'unknown', entries: [] };
				}

				if (import.meta.env.DEV) {
					// eslint-disable-next-line no-console
					console.info('[CodexChat] Resume thread item types:', typeCounts);
				}

				setTurnOrder(nextOrder);
				setTurnsById(nextTurns);
				setCollapsedRepliesByTurnId(nextRepliesCollapsed);
				setCollapsedByEntryId(nextEntryCollapse);
				setItemToTurnId(nextItemToTurn);
				itemToTurnRef.current = nextItemToTurn;
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
		[settings.defaultCollapseDetails]
	);

	const createNewSession = useCallback(async () => {
		setTurnOrder([]);
		setTurnsById({});
		setThreadTokenUsage(null);
		setCollapsedRepliesByTurnId({});
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
		}, [listSessions, selectedModel]);

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
			await dialogMessage(`AgentMesh\nVersion ${version}`, 'About AgentMesh');
		} catch {
			try {
				await dialogMessage('AgentMesh', 'About AgentMesh');
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
		// Allow sending if there's text, or if a skill/prompt is selected
		if (!trimmedInput && !selectedSkill && !selectedPrompt) return;

		// Build attachments list for UI display
		const attachments: AttachmentItem[] = [];
		for (const f of fileAttachments) {
			attachments.push({ type: 'file', path: f.path, name: f.name });
		}
		if (selectedSkill) {
			attachments.push({ type: 'skill', name: selectedSkill.name });
		}
		if (selectedPrompt) {
			attachments.push({ type: 'prompt', name: selectedPrompt.name });
		}

		setSending(true);
		try {
			let threadId = selectedThreadId;
			let currentRepoPath = activeThread?.cwd ?? null;
			if (!threadId) {
				const res = await apiClient.codexThreadStart(selectedModel);
				const thread = normalizeThreadFromResponse(res);
				if (!thread) throw new Error('Failed to start thread');
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

			// Build CodexUserInput array for API
			const codexInput: CodexUserInput[] = [];

			// Add text input
			codexInput.push({ type: 'text', text: outgoingText });

			// Add skill with name and path
			if (selectedSkill) {
				codexInput.push({ type: 'skill', name: selectedSkill.name, path: selectedSkill.path });
			}

			// Create user entry with attachments
			const userEntry: ChatEntry = {
				kind: 'user',
				id: `user-${crypto.randomUUID()}`,
				text: trimmedInput,
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
			await apiClient.codexTurnStart(threadId, codexInput, selectedModel, selectedEffort, approvalPolicy);
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
		fileAttachments,
		selectedSkill,
		selectedPrompt,
	]);

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

	const toggleTurnReplies = useCallback((turnId: string) => {
		skipAutoScrollRef.current = true;
		setCollapsedRepliesByTurnId((prev) => {
			const nextCollapsed = !(prev[turnId] ?? false);
			if (import.meta.env.DEV && !nextCollapsed) {
				const turn = turnsById[turnId];
				const counts = turn ? countEntryKinds(turn.entries) : {};
				// eslint-disable-next-line no-console
				console.info('[CodexChat] Expand turn:', {
					turnId,
					entryKinds: counts,
				});
			}
			return { ...prev, [turnId]: nextCollapsed };
		});
	}, [turnsById]);

	// Context management callbacks
	const addRelatedRepoDir = useCallback(async () => {
		if (!selectedThreadId) return;
		const currentRepoPath = activeThread?.cwd;
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
		[selectedThreadId]
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
				const cwd = activeThread?.cwd ?? '.';
				const results = await apiClient.searchWorkspaceFiles(cwd, query, 8);
				setFileSearchResults(results);
			} catch {
				setFileSearchResults([]);
			}
		},
		[activeThread?.cwd]
	);

	const addFileAttachment = useCallback(
		async (file: FileInfo) => {
			try {
				const cwd = activeThread?.cwd ?? '.';
				const fullPath = file.path.startsWith('/') ? file.path : `${cwd}/${file.path}`;
				const content = await apiClient.readFileContent(fullPath);
				setFileAttachments((prev) => {
					if (prev.some((f) => f.path === file.path)) return prev;
					return [...prev, { path: file.path, name: file.name, content }];
				});
				setIsAddContextOpen(false);
				setFileSearchQuery('');
				setFileSearchResults([]);
			} catch {
				// ignore
			}
		},
		[activeThread?.cwd]
	);

	const removeFileAttachment = useCallback((path: string) => {
		setFileAttachments((prev) => prev.filter((f) => f.path !== path));
	}, []);

	const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			const base64 = reader.result as string;
			setFileAttachments((prev) => [...prev, { path: file.name, name: file.name, content: base64 }]);
		};
		reader.readAsDataURL(file);
		setIsAddContextOpen(false);
		if (fileInputRef.current) fileInputRef.current.value = '';
	}, []);

	const filteredSlashCommands: FilteredSlashCommand[] = useMemo(() => {
		// 去掉前导斜杠和空白
		const query = slashSearchQuery.trim().replace(/^\/+/, '');
		if (!query) {
			return SLASH_COMMANDS.map((cmd) => ({ cmd, indices: null, score: 0 }));
		}

		const results: FilteredSlashCommand[] = [];

		for (const cmd of SLASH_COMMANDS) {
			// 匹配 id 或 label
			const matchId = fuzzyMatch(cmd.id, query);
			const matchLabel = fuzzyMatch(cmd.label, query);

			// 取最佳匹配
			const candidates = [matchId, matchLabel].filter((m): m is NonNullable<typeof m> => m !== null);
			if (candidates.length > 0) {
				const best = candidates.sort((a, b) => a.score - b.score)[0];
				results.push({ cmd, indices: best.indices, score: best.score });
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
			const matchName = fuzzyMatch(skill.name, query);
			const matchDesc = fuzzyMatch(skill.description, query);

			const candidates = [matchName, matchDesc].filter((m): m is NonNullable<typeof m> => m !== null);
			if (candidates.length > 0) {
				const best = candidates.sort((a, b) => a.score - b.score)[0];
				results.push({ skill, indices: best.indices, score: best.score });
			}
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

		const results: FilteredPrompt[] = [];

		for (const prompt of prompts) {
			// Match against "prompts:name" format or just "name"
			const displayName = `prompts:${prompt.name}`;
			const matchDisplay = fuzzyMatch(displayName, query);
			const matchName = fuzzyMatch(prompt.name, query);
			const matchDesc = prompt.description ? fuzzyMatch(prompt.description, query) : null;

			const candidates = [matchDisplay, matchName, matchDesc].filter((m): m is NonNullable<typeof m> => m !== null);
			if (candidates.length > 0) {
				const best = candidates.sort((a, b) => a.score - b.score)[0];
				results.push({ prompt, indices: best.indices, score: best.score });
			}
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
			const matchName = fuzzyMatch(skill.name, query);
			const matchDesc = fuzzyMatch(skill.description, query);

			const candidates = [matchName, matchDesc].filter((m): m is NonNullable<typeof m> => m !== null);
			if (candidates.length > 0) {
				const best = candidates.sort((a, b) => a.score - b.score)[0];
				results.push({ skill, indices: best.indices, score: best.score });
			}
		}

		return results.sort((a, b) => a.score - b.score);
	}, [skillSearchQuery, skills]);

	// Execute skill selection - display as tag in input area (no text insertion)
	const executeSkillSelection = useCallback(
		(skill: SkillMetadata) => {
			setIsSkillMenuOpen(false);
			setIsSlashMenuOpen(false);
			setSkillSearchQuery('');
			setSlashSearchQuery('');
			setSkillHighlightIndex(0);
			setSlashHighlightIndex(0);
			setSelectedSkill(skill);

			// Focus back to textarea
			setTimeout(() => textareaRef.current?.focus(), 0);
		},
		[]
	);

	// Execute prompt selection - display as tag in input area (no text insertion)
	const executePromptSelection = useCallback(
		(prompt: CustomPrompt) => {
			setIsSlashMenuOpen(false);
			setIsSkillMenuOpen(false);
			setSlashSearchQuery('');
			setSkillSearchQuery('');
			setSlashHighlightIndex(0);
			setSkillHighlightIndex(0);
			setSelectedPrompt(prompt);

			// Focus back to textarea
			setTimeout(() => textareaRef.current?.focus(), 0);
		},
		[]
	);

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
					setIsSessionsOpen(true);
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
					setCollapsedByEntryId({});
					break;
				case 'context':
					setAutoContextEnabled((v) => !v);
					break;
			}
		},
		[
			approvalPolicy,
			autoContextEnabled,
			createNewSession,
			selectedEffort,
			selectedModel,
			selectedThreadId,
			threadTokenUsage,
		]
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
		[executeSlashCommand, executeSkillSelection, executePromptSelection, filteredSlashCommands, filteredSkills, filteredPromptsForSlashMenu, filteredSkillsForSlashMenu, input, isSlashMenuOpen, isSkillMenuOpen, sendMessage, slashHighlightIndex, skillHighlightIndex, slashMenuTotalItems]
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
		listSessions();
		loadModelsAndChatDefaults();
		void loadWorkspaceRoot();
		void loadRecentWorkspaces();
		void loadSkills();
		void loadPrompts();
	}, [listSessions, loadModelsAndChatDefaults, loadWorkspaceRoot, loadRecentWorkspaces, loadSkills, loadPrompts]);

	useEffect(() => {
		let mounted = true;
		const unlistenPromise = listen<CodexJsonRpcEvent>('codex_app_server', (event) => {
			if (!mounted) return;
			const payload = event.payload;
			if (!payload || typeof payload !== 'object') return;

			if (payload.kind === 'stderr') {
				return;
			}

			const message = payload.message as any;
			const method = safeString(message?.method);

			if (payload.kind === 'notification') {
				const params = message?.params ?? null;
				const threadId = safeString(params?.threadId ?? params?.thread_id);
				if (selectedThreadId && threadId && threadId !== selectedThreadId) return;

				if (method === 'thread/tokenUsage/updated') {
					const tokenUsage = params?.tokenUsage ?? params?.token_usage ?? null;
					const totalTokens = Number(tokenUsage?.total?.totalTokens ?? tokenUsage?.total?.total_tokens);
					const contextWindowRaw = tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window;
					const contextWindow = contextWindowRaw == null ? null : Number(contextWindowRaw);
					if (!Number.isFinite(totalTokens)) return;
					setThreadTokenUsage({
						totalTokens,
						contextWindow: Number.isFinite(contextWindow) ? contextWindow : null,
					});
					return;
				}

					if (method === 'turn/started') {
						const turnId = safeString(params?.turn?.id ?? params?.turnId);
						if (!turnId) return;

						setActiveTurnId(turnId);
						setTurnOrder((prev) => {
							const withoutPending = prev.filter((id) => id !== PENDING_TURN_ID);
							if (withoutPending.includes(turnId)) return withoutPending;
							return [...withoutPending, turnId];
						});
						setTurnsById((prev) => {
							const pending = prev[PENDING_TURN_ID];
							const existing = prev[turnId];
							const mergedEntries = [...(pending?.entries ?? []), ...(existing?.entries ?? [])];

						const next: Record<string, TurnBlock> = {
							...prev,
							[turnId]: {
								id: turnId,
								status: 'inProgress',
								entries: mergedEntries,
							},
						};
						delete next[PENDING_TURN_ID];
						return next;
					});
					return;
				}

				if (method === 'turn/completed') {
					const turnId = safeString(params?.turn?.id ?? params?.turnId);
					if (!turnId) return;

					const status = parseTurnStatus(params?.turn?.status ?? 'completed');
					setTurnsById((prev) => {
						const existing = prev[turnId] ?? {
							id: turnId,
							status: 'unknown' as const,
							entries: [],
						};
						return { ...prev, [turnId]: { ...existing, status } };
					});
					if (activeTurnId === turnId) setActiveTurnId(null);
					return;
				}

				if (method === 'item/started' || method === 'item/completed') {
					const item = params?.item as CodexThreadItem | undefined;
					if (!item) return;
					const entry = entryFromThreadItem(item);
					if (!entry) return;
					const explicitTurnId = safeString(params?.turnId ?? params?.turn_id ?? params?.turn?.id);
					const turnId = explicitTurnId || activeTurnId || PENDING_TURN_ID;

					itemToTurnRef.current = {
						...itemToTurnRef.current,
						[entry.id]: turnId,
					};
					setItemToTurnId(itemToTurnRef.current);

						setTurnOrder((prev) => (prev.includes(turnId) ? prev : [...prev, turnId]));
					setTurnsById((prev) => {
						const existing = prev[turnId] ?? {
							id: turnId,
							status: 'inProgress' as const,
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
						if (Object.prototype.hasOwnProperty.call(prev, entry.id)) return prev;
						return { ...prev, [entry.id]: settings.defaultCollapseDetails };
					});
					return;
				}

				if (method === 'item/agentMessage/delta') {
					const itemId = safeString(params?.itemId);
					const delta = safeString(params?.delta);
					if (!itemId || !delta) return;
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						return {
							...prev,
							[turnId]: {
								...existing,
								entries: appendDelta(existing.entries, itemId, 'message', delta),
							},
						};
					});
					return;
				}

				if (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
					const itemId = safeString(params?.itemId);
					const delta = safeString(params?.delta);
					if (!itemId || !delta) return;
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						return {
							...prev,
							[turnId]: {
								...existing,
								entries: appendDelta(existing.entries, itemId, 'reasoning', delta),
							},
						};
					});
					return;
				}

				if (method === 'item/mcpToolCall/progress') {
					const itemId = safeString(params?.itemId);
					const progress = safeString(params?.message);
					if (!itemId || !progress) return;
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						const idx = existing.entries.findIndex((e) => e.kind === 'mcp' && e.id === itemId);
						if (idx === -1) return prev;
						const entriesCopy = [...existing.entries];
						const e = entriesCopy[idx] as Extract<ChatEntry, { kind: 'mcp' }>;
						entriesCopy[idx] = { ...e, message: progress };
						return {
							...prev,
							[turnId]: { ...existing, entries: entriesCopy },
						};
					});
					return;
				}

				if (method === 'error') {
					const errMsg = safeString(params?.error?.message);
					if (!errMsg) return;
					const turnId = activeTurnId ?? PENDING_TURN_ID;
					const entry: ChatEntry = {
						kind: 'system',
						id: `system-err-${crypto.randomUUID()}`,
						tone: 'error',
						text: errMsg,
					};
					setTurnOrder((prev) => (prev.includes(turnId) ? prev : [...prev, turnId]));
					setTurnsById((prev) => {
						const existing = prev[turnId] ?? {
							id: turnId,
							status: 'unknown' as const,
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

			if (payload.kind === 'request') {
				const params = message?.params ?? null;
				const threadId = safeString(params?.threadId);
				if (selectedThreadId && threadId && threadId !== selectedThreadId) return;

				const requestId = Number(message?.id);
				if (!Number.isFinite(requestId)) return;

				if (method === 'item/commandExecution/requestApproval') {
					const itemId = safeString(params?.itemId);
					const reason = params?.reason ? String(params.reason) : null;
					if (!itemId) return;
					const explicitTurnId = safeString(params?.turnId ?? params?.turn_id);
					const turnId = explicitTurnId || itemToTurnRef.current[itemId] || activeTurnId || PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						const updated = existing.entries.map((e) => {
							if (e.kind !== 'command' || e.id !== itemId) return e;
							return { ...e, approval: { requestId, reason } };
						});
						return { ...prev, [turnId]: { ...existing, entries: updated } };
					});
					return;
				}

				if (method === 'item/fileChange/requestApproval') {
					const itemId = safeString(params?.itemId);
					const reason = params?.reason ? String(params.reason) : null;
					if (!itemId) return;
					const explicitTurnId = safeString(params?.turnId ?? params?.turn_id);
					const turnId = explicitTurnId || itemToTurnRef.current[itemId] || activeTurnId || PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						const updated = existing.entries.map((e) => {
							if (e.kind !== 'fileChange' || e.id !== itemId) return e;
							return { ...e, approval: { requestId, reason } };
						});
						return { ...prev, [turnId]: { ...existing, entries: updated } };
					});
					return;
				}
			}
		});

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
				: turn.entries.filter((e) => e.kind !== 'assistant' || e.role !== 'reasoning');

			const chatEntries = visible.filter((e) => !isActivityEntry(e));
			const activityEntries = visible.filter(isActivityEntry);
			const userEntries = chatEntries.filter((e) => e.kind === 'user') as Extract<ChatEntry, { kind: 'user' }>[];
			const replyEntries = chatEntries.filter((e) => e.kind !== 'user');
			const assistantMessages = replyEntries.filter(
				(e): e is Extract<ChatEntry, { kind: 'assistant' }> => e.kind === 'assistant' && e.role === 'message'
			);
			const finalAssistantMessageId =
				assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1].id : null;

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

				const visibleRepliesCount = repliesCollapsed
					? t.replyEntries.filter((e) => e.kind === 'system').length + (t.finalAssistantMessageId ? 1 : 0)
					: t.replyEntries.length;
				const visibleActivityCount = !repliesCollapsed ? t.activityEntries.length : 0;

				return acc + t.userEntries.length + visibleRepliesCount + visibleActivityCount;
			}, 0);
		}, [collapsedRepliesByTurnId, renderTurns]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		if (skipAutoScrollRef.current) {
			skipAutoScrollRef.current = false;
			return;
		}
		el.scrollTop = el.scrollHeight;
	}, [renderCount]);

	const sidebarIconButtonPx = Math.round(SIDEBAR_ICON_BUTTON_PX);
	const sidebarIconSizePx = Math.max(10, Math.round(sidebarIconButtonPx * 0.62));

	return (
		<div className="flex h-full min-w-0 flex-col overflow-x-hidden">
			{/* 自定义标题栏 */}
			<div
				className="flex h-10 shrink-0 items-center border-b border-white/10 bg-bg-panel/60"
				data-tauri-drag-region
			>
				{/* macOS 窗口按钮占位 */}
				<div
					className="w-20 shrink-0"
					data-tauri-drag-region
				/>

				<div className="flex min-w-0 items-center gap-2">
					{/* 项目选择下拉菜单 */}
					<div className="relative shrink-0">
						<button
							type="button"
							className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-menuDivider bg-bg-panel/40 px-2.5 text-[13px] font-medium text-text-main hover:bg-bg-panelHover transition-colors"
							onClick={() => setIsWorkspaceMenuOpen((v) => !v)}
							title={activeThread?.cwd ?? workspaceRoot ?? ''}
						>
							<span className="truncate">
								{activeThread?.cwd || workspaceRoot
									? repoNameFromPath(activeThread?.cwd ?? workspaceRoot ?? '')
									: 'Select Project'}
							</span>
							<ChevronDown className="h-4 w-4 text-text-menuLabel" />
						</button>

						{isWorkspaceMenuOpen ? (
							<>
								<div
									className="fixed inset-0 z-40"
									onClick={() => setIsWorkspaceMenuOpen(false)}
									role="button"
									tabIndex={0}
								/>
								<div className={`absolute left-0 top-full z-50 mt-2 w-[260px] p-1.5 ${MENU_STYLES.popover}`}>
									{/* CURRENT PROJECT */}
									<div className={MENU_STYLES.popoverTitle}>Current Project</div>
									<button
										type="button"
										className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-bg-menuItemHover transition-colors"
										title={activeThread?.cwd ?? workspaceRoot ?? ''}
									>
										<div className="flex min-w-0 items-center gap-2">
											<Folder className="h-4 w-4 shrink-0 text-text-menuLabel" />
											<div className="min-w-0">
												<div className="truncate text-[12px] font-medium text-text-main">
													{repoNameFromPath(activeThread?.cwd ?? workspaceRoot ?? '') || 'Not set'}
												</div>
												<div className="truncate text-[11px] text-text-menuDesc">
													{activeThread?.cwd ?? workspaceRoot
														? `~${(activeThread?.cwd ?? workspaceRoot ?? '').replace(/^\/Users\/[^/]+/, '')}`
														: 'No project selected'}
												</div>
											</div>
										</div>
										<ChevronRight className="h-4 w-4 shrink-0 text-text-menuLabel" />
									</button>

									<div className="mx-2 my-1.5 border-t border-border-menuDivider" />

									{/* New Window */}
									<button
										type="button"
										className={MENU_STYLES.popoverItem}
										onClick={() => void openNewWindow()}
									>
										<Box className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
										<span>New Window</span>
									</button>

									{/* Open Project */}
									<button
										type="button"
										className={MENU_STYLES.popoverItem}
										onClick={() => void openWorkspaceDialog()}
									>
										<Folder className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
										<span>Open Project</span>
									</button>

									{/* RECENT PROJECTS */}
									{recentWorkspaces.filter((p) => p !== (activeThread?.cwd ?? workspaceRoot)).length > 0 ? (
										<>
											<div className="mx-2 my-1.5 border-t border-border-menuDivider" />
											<div className={MENU_STYLES.popoverTitle}>Recent Projects</div>
											<div>
												{recentWorkspaces
													.filter((p) => p !== (activeThread?.cwd ?? workspaceRoot))
													.slice(0, 5)
													.map((path) => (
														<button
															key={path}
															type="button"
															className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-bg-menuItemHover transition-colors"
															onClick={() => void applyWorkspaceRoot(path)}
															title={path}
														>
															<Folder className="h-4 w-4 shrink-0 text-text-menuLabel" />
															<div className="min-w-0">
																<div className="truncate text-[12px] font-medium text-text-main">
																	{repoNameFromPath(path)}
																</div>
																<div className="truncate text-[11px] text-text-menuDesc">
																	{`~${path.replace(/^\/Users\/[^/]+/, '')}`}
																</div>
															</div>
														</button>
													))}
											</div>
										</>
									) : null}

									<div className="mx-2 my-1.5 border-t border-border-menuDivider" />

									{/* About */}
									<button
										type="button"
										className={MENU_STYLES.popoverItem}
										onClick={() => void showAbout()}
									>
										<Info className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
										<span>About AgentMesh</span>
									</button>

									{/* Check for Updates */}
									<button
										type="button"
										className={MENU_STYLES.popoverItem}
										onClick={() => void showUpdates()}
									>
										<RotateCw className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
										<span>Check for Updates...</span>
									</button>
								</div>
							</>
						) : null}
					</div>

					{activeThread?.cwd && relatedRepoPaths.length > 0 ? (
						<div className="flex min-w-0 flex-nowrap items-center gap-1.5">
							{relatedRepoPaths.map((path) => (
								<div
									key={path}
									className="group inline-flex h-7 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 text-[11px] leading-none text-text-main"
									title={path}
								>
									<span className="max-w-[140px] truncate">{repoNameFromPath(path)}</span>
									<button
										type="button"
										className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-red-300 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-red-500/70 hover:text-white"
										onClick={() => removeRelatedRepoDir(path)}
										aria-label={`Remove related repo ${repoNameFromPath(path)}`}
									>
										-
									</button>
								</div>
							))}
						</div>
					) : null}

					{selectedThreadId && activeThread?.cwd && relatedRepoPaths.length < 3 ? (
						<button
							type="button"
							className="inline-flex h-7 items-center rounded px-2 text-[11px] leading-none text-text-muted hover:bg-white/5 hover:text-text-main"
							onClick={() => void addRelatedRepoDir()}
							title="Add related dir"
						>
							+ add dir
						</button>
					) : null}
				</div>

				<div
					className="flex-1"
					data-tauri-drag-region
				/>

				<div className="relative mr-3 flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-menuDivider bg-bg-panel/40 text-text-main hover:bg-bg-panelHover transition-colors"
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
						className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-menuDivider bg-bg-panel/40 text-text-main hover:bg-bg-panelHover transition-colors"
						onClick={() => setIsSettingsMenuOpen((v) => !v)}
						title="Menu"
					>
						<Settings className="h-5 w-5" />
					</button>

					{isSettingsMenuOpen ? (
						<>
							<div
								className="fixed inset-0 z-40"
								onClick={() => setIsSettingsMenuOpen(false)}
								role="button"
								tabIndex={0}
							/>
							<div className={`absolute right-0 top-[44px] z-50 w-[220px] p-1.5 ${MENU_STYLES.popover}`}>
								<div className={MENU_STYLES.popoverTitle}>Menu</div>
								<button
									type="button"
									className={MENU_STYLES.popoverItem}
									onClick={() => {
										setIsSettingsMenuOpen(false);
										void openWorkspaceDialog();
									}}
								>
									Switch workspace…
								</button>
								<button
									type="button"
									className={MENU_STYLES.popoverItem}
									onClick={() => {
										setIsSettingsMenuOpen(false);
										setIsSettingsOpen(true);
									}}
								>
									Settings
								</button>
								<button
									type="button"
									className={MENU_STYLES.popoverItem}
									onClick={() => {
										setIsSettingsMenuOpen(false);
										void openConfig();
									}}
								>
									Edit config.toml
								</button>
								<button
									type="button"
									className={MENU_STYLES.popoverItem}
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

			{/* 主内容区域 */}
			<div className="flex min-h-0 min-w-0 flex-1">
				<div
					className="relative shrink-0"
					style={{ width: SIDEBAR_WIDTH_PX }}
				>
					<aside className="flex h-full w-full flex-col items-center gap-4 border-r border-white/10 bg-bg-panel/40 pt-6 pb-0.5">
						<button
							type="button"
							className="flex items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-text-main"
							title="Codex"
							style={{ width: sidebarIconButtonPx, height: sidebarIconButtonPx }}
						>
							<span style={{ fontSize: sidebarIconSizePx, lineHeight: 1 }}>✷</span>
						</button>

						<div className="flex flex-col items-center gap-3">
							<button
								type="button"
								className="flex items-center justify-center rounded-lg border border-white/10 bg-bg-panelHover text-text-main hover:border-white/20"
								onClick={() => void createNewSession()}
								title="New session"
								style={{ width: sidebarIconButtonPx, height: sidebarIconButtonPx }}
							>
								<Plus size={sidebarIconSizePx} />
							</button>
						</div>
					</aside>
				</div>

				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col px-8 pt-6 pb-0.5">
					<div className="relative flex items-center justify-between gap-4">
						<div className="min-w-0 flex-1">
							{workspaceRootError ? <div className="mt-2 text-xs text-status-warning">{workspaceRootError}</div> : null}
						</div>

						<div className="relative flex shrink-0 items-center">
							<button
								type="button"
								className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#057812] text-white hover:bg-[#068414]"
								onClick={() => {
									setIsSettingsMenuOpen(false);
									void createNewSession();
								}}
								title="New session"
							>
								<Plus className="h-5 w-5" />
							</button>
						</div>
					</div>

					<div
						ref={scrollRef}
						className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden pb-4"
					>
						{renderTurns.map((turn) => {
							const repliesCollapsed = collapsedRepliesByTurnId[turn.id] ?? false;
							const hasActivity = turn.activityEntries.length > 0;
							const showActivity = hasActivity && !repliesCollapsed;
							const replyEntries = repliesCollapsed
								? turn.replyEntries.filter((e) => {
										if (e.kind === 'system') return true;
										return e.kind === 'assistant' && e.role === 'message' && e.id === turn.finalAssistantMessageId;
								  })
								: turn.replyEntries;

							return (
								<div
									key={turn.id}
									className="space-y-2"
								>
									<div className="space-y-2">
										{turn.userEntries.map((e) => (
											<div
												key={e.id}
												className="flex justify-end"
											>
												<div className="max-w-[77%] rounded-2xl bg-white/5 px-3 py-2 text-sm text-text-main">
													{/* Attachments in message bubble */}
													{e.attachments && e.attachments.length > 0 ? (
														<div className="mb-2 flex flex-wrap gap-1">
															{e.attachments.map((att, idx) => (
																<div
																	key={`${e.id}-att-${idx}`}
																	className={[
																		'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
																		att.type === 'file'
																			? 'bg-white/10 text-text-muted'
																			: att.type === 'skill'
																				? 'bg-primary/20 text-primary'
																				: 'bg-blue-500/20 text-blue-400',
																	].join(' ')}
																>
																	{att.type === 'file' ? (
																		<File className="h-3 w-3" />
																	) : att.type === 'skill' ? (
																		<Zap className="h-3 w-3" />
																	) : (
																		<FileText className="h-3 w-3" />
																	)}
																	<span className="max-w-[100px] truncate">
																		{att.type === 'prompt' ? `prompts:${att.name}` : att.name}
																	</span>
																</div>
															))}
														</div>
													) : null}
													<ChatMarkdown
														text={e.text}
														className="text-text-main"
														dense
													/>
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
													{turn.id === PENDING_TURN_ID ? ' (pending)' : ''}
												</span>
												{repliesCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
											</span>
										</button>
									</div>

									{showActivity ? (
										<div className="space-y-2">
											{turn.activityEntries.map((e) => {
												if (e.kind === 'command') {
													const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
													// 构建完整内容用于复制
													const displayContent = [
														`$ ${e.command}`,
														e.cwd ? `cwd: ${e.cwd}` : '',
														e.output ?? '',
													]
														.filter(Boolean)
														.join('\n');
													return (
														<ActivityBlock
															key={e.id}
															titlePrefix="Ran"
															titleContent={e.command}
															titleMono
															status={e.status}
															copyContent={displayContent.replace(/\x1b\[[0-9;]*m/g, '')}
															collapsible
															collapsed={collapsed}
															onToggleCollapse={() => toggleEntryCollapse(e.id)}
															approval={e.approval}
															onApprove={approve}
														>
															{displayContent}
														</ActivityBlock>
													);
												}

												if (e.kind === 'fileChange') {
													const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
													// 构建完整内容用于复制
													const fullContent = e.changes
														.map((c) => `${c.path}\n${c.diff ?? ''}`)
														.join('\n\n');
													return (
														<ActivityBlock
															key={e.id}
															titlePrefix="Edited"
															titleContent={e.changes.map((c) => c.path).join(', ')}
															status={e.status}
															copyContent={fullContent}
															collapsible
															collapsed={collapsed}
															onToggleCollapse={() => toggleEntryCollapse(e.id)}
															approval={e.approval}
															onApprove={approve}
														>
															{fullContent}
														</ActivityBlock>
													);
												}

												if (e.kind === 'webSearch') {
													const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
													return (
														<ActivityBlock
															key={e.id}
															titlePrefix="Web search"
															titleContent={e.query}
															copyContent={e.query}
															collapsible
															collapsed={collapsed}
															onToggleCollapse={() => toggleEntryCollapse(e.id)}
														>
															{e.query}
														</ActivityBlock>
													);
												}

												if (e.kind === 'mcp') {
													const toolCall = `${e.server}.${e.tool}`;
													const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
													const content = e.message ? `${toolCall}\n${e.message}` : toolCall;
													return (
														<ActivityBlock
															key={e.id}
															titlePrefix="MCP"
															titleContent={toolCall}
															titleMono
															status={e.status}
															copyContent={content}
															collapsible
															collapsed={collapsed}
															onToggleCollapse={() => toggleEntryCollapse(e.id)}
														>
															{content}
														</ActivityBlock>
													);
												}

												return null;
											})}
										</div>
									) : null}

									<div className="space-y-2">
										{replyEntries.map((e) => {
											if (e.kind === 'assistant') {
												const isReasoning = e.role === 'reasoning';
												return (
													<div
														key={e.id}
														className={[
															'px-1 py-1',
															isReasoning
																? 'text-text-muted'
																: 'text-text-muted',
														].join(' ')}
													>
														{isReasoning ? <div className="mb-1 text-[10px] text-text-dim">Reasoning</div> : null}
														{e.streaming ? <div className="mb-1 text-[10px] text-text-dim">Streaming…</div> : null}
														<ChatMarkdown
															text={e.text}
															className={isReasoning ? 'text-text-dim' : 'text-text-muted'}
															dense
														/>
													</div>
												);
											}

											if (e.kind === 'system') {
												const tone = e.tone ?? 'info';
												const color =
													tone === 'error'
														? 'border-status-error/30 bg-status-error/10 text-status-error'
														: tone === 'warning'
														? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
														: 'border-white/10 bg-bg-panelHover text-text-muted';

												return (
													<div
														key={e.id}
														className={`rounded-lg border px-3 py-2 text-xs ${color}`}
													>
														<div className="whitespace-pre-wrap break-words">{e.text}</div>
													</div>
												);
											}

											return null;
										})}
									</div>
								</div>
							);
						})}
					</div>

					<div className="relative -mx-6 mt-3 rounded-xl border border-white/10 bg-bg-panel/70 px-4 py-3 backdrop-blur">
						{/* Popup Menu - shared container for +, / and $ menus */}
						{isSlashMenuOpen || isAddContextOpen || isSkillMenuOpen ? (
							<>
								<div
									className="fixed inset-0 z-40"
									onClick={() => {
										if (isSlashMenuOpen) {
											setIsSlashMenuOpen(false);
											setSlashSearchQuery('');
											setSlashHighlightIndex(0);
										}
										if (isAddContextOpen) {
											setIsAddContextOpen(false);
											setFileSearchQuery('');
											setFileSearchResults([]);
										}
										if (isSkillMenuOpen) {
											setIsSkillMenuOpen(false);
											setSkillSearchQuery('');
											setSkillHighlightIndex(0);
										}
									}}
									role="button"
									tabIndex={0}
								/>
								<div className={`${MENU_STYLES.popoverPosition} ${MENU_STYLES.popover}`}>
									{/* Search input */}
									<input
										type="text"
										className={`mb-2 ${MENU_STYLES.searchInput}`}
										placeholder={isSlashMenuOpen ? 'Search commands...' : isSkillMenuOpen ? 'Search skills...' : 'Search files...'}
										value={isSlashMenuOpen ? slashSearchQuery : isSkillMenuOpen ? skillSearchQuery : fileSearchQuery}
										onChange={(e) => {
											if (isSlashMenuOpen) {
												setSlashSearchQuery(e.target.value);
												setSlashHighlightIndex(0);
											} else if (isSkillMenuOpen) {
												setSkillSearchQuery(e.target.value);
												setSkillHighlightIndex(0);
											} else {
												void searchFiles(e.target.value);
											}
										}}
										onKeyDown={(e) => {
											// 处理方向键导航
											if (e.key === 'ArrowDown') {
												e.preventDefault();
												if (isSlashMenuOpen) {
													setSlashHighlightIndex((i) => Math.min(i + 1, slashMenuTotalItems - 1));
												} else if (isSkillMenuOpen) {
													setSkillHighlightIndex((i) => Math.min(i + 1, filteredSkills.length - 1));
												}
												return;
											}
											if (e.key === 'ArrowUp') {
												e.preventDefault();
												if (isSlashMenuOpen) {
													setSlashHighlightIndex((i) => Math.max(i - 1, 0));
												} else if (isSkillMenuOpen) {
													setSkillHighlightIndex((i) => Math.max(i - 1, 0));
												}
												return;
											}
											// Tab 键补全
											if (e.key === 'Tab') {
												e.preventDefault();
												if (isSlashMenuOpen) {
													if (slashHighlightIndex < filteredSlashCommands.length) {
														const selected = filteredSlashCommands[slashHighlightIndex];
														if (selected) {
															setInput(`/${selected.cmd.id} `);
															setIsSlashMenuOpen(false);
															setSlashSearchQuery('');
															textareaRef.current?.focus();
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
												} else if (isSkillMenuOpen) {
													const selected = filteredSkills[skillHighlightIndex];
													if (selected) {
														executeSkillSelection(selected.skill);
													}
												}
												return;
											}
											// Enter 键执行
											if (e.key === 'Enter') {
												e.preventDefault();
												if (isSlashMenuOpen) {
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
												} else if (isSkillMenuOpen) {
													const selected = filteredSkills[skillHighlightIndex];
													if (selected) executeSkillSelection(selected.skill);
												}
												return;
											}
											// Escape 键关闭菜单
											if (e.key === 'Escape') {
												e.preventDefault();
												if (isSlashMenuOpen) {
													setIsSlashMenuOpen(false);
													setSlashSearchQuery('');
												} else if (isSkillMenuOpen) {
													setIsSkillMenuOpen(false);
													setSkillSearchQuery('');
												} else if (isAddContextOpen) {
													setIsAddContextOpen(false);
													setFileSearchQuery('');
													setFileSearchResults([]);
												}
												textareaRef.current?.focus();
												return;
											}
										}}
										autoFocus
									/>
									{/* Content list */}
									<div ref={menuListRef} className={MENU_STYLES.listContainer}>
										{isSkillMenuOpen ? (
											// Skills list (triggered by $)
											filteredSkills.length > 0 ? (
												filteredSkills.map(({ skill, indices }, idx) => (
													<button
														key={skill.name}
														type="button"
														data-highlighted={idx === skillHighlightIndex}
														className={
															idx === skillHighlightIndex ? MENU_STYLES.popoverItemActive : MENU_STYLES.popoverItem
														}
														onClick={() => executeSkillSelection(skill)}
														onMouseEnter={() => setSkillHighlightIndex(idx)}
													>
														<Zap className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
														<span>
															{indices && indices.length > 0
																? highlightMatches(skill.name, indices)
																: skill.name}
														</span>
														<span className={MENU_STYLES.popoverItemDesc} title={skill.shortDescription || skill.description}>
															{skill.shortDescription || skill.description}
														</span>
													</button>
												))
											) : (
												<div className={`${MENU_STYLES.popoverItemDesc} px-2 py-1`}>
													{skills.length === 0 ? 'No skills available' : 'No matching skills'}
												</div>
											)
										) : isSlashMenuOpen ? (
											// Slash menu: Commands + Prompts + Skills
											<>
												{/* Commands section */}
												{filteredSlashCommands.length > 0 && (
													<>
														<div className={MENU_STYLES.popoverTitle}>Commands</div>
														{filteredSlashCommands.map(({ cmd, indices }, idx) => {
															const IconComponent =
																cmd.icon === 'cpu'
																	? Cpu
																	: cmd.icon === 'shield'
																		? Shield
																		: cmd.icon === 'zap'
																			? Zap
																			: cmd.icon === 'search'
																				? Search
																				: cmd.icon === 'plus'
																					? Plus
																					: cmd.icon === 'play'
																						? Play
																						: cmd.icon === 'file-plus'
																							? FilePlus
																							: cmd.icon === 'minimize'
																								? Minimize2
																								: cmd.icon === 'git-branch'
																									? GitBranch
																									: cmd.icon === 'at-sign'
																										? AtSign
																										: cmd.icon === 'info'
																											? Info
																											: cmd.icon === 'tool'
																												? Wrench
																												: cmd.icon === 'log-out'
																													? LogOut
																													: cmd.icon === 'x'
																														? X
																														: cmd.icon === 'message'
																															? FileText
																															: cmd.icon === 'trash'
																																? Trash2
																																: cmd.icon === 'paperclip'
																																	? Paperclip
																																	: Search;
															return (
																<button
																	key={cmd.id}
																	type="button"
																	data-highlighted={idx === slashHighlightIndex}
																	className={
																		idx === slashHighlightIndex ? MENU_STYLES.popoverItemActive : MENU_STYLES.popoverItem
																	}
																	onClick={() => executeSlashCommand(cmd.id)}
																	onMouseEnter={() => setSlashHighlightIndex(idx)}
																>
																	<IconComponent className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
																	<span>
																		{indices && indices.length > 0
																			? highlightMatches(cmd.label, indices)
																			: cmd.label}
																	</span>
																	<span className={MENU_STYLES.popoverItemDesc} title={cmd.description}>{cmd.description}</span>
																</button>
															);
														})}
													</>
												)}
												{/* Prompts section */}
												{filteredPromptsForSlashMenu.length > 0 && (
													<>
														<div
															className={`${MENU_STYLES.popoverTitle} ${
																filteredSlashCommands.length > 0 ? 'mt-2 border-t border-border-menuDivider pt-2' : ''
															}`}
														>
															Prompts
														</div>
														{filteredPromptsForSlashMenu.map(({ prompt, indices }, idx) => {
															const globalIdx = filteredSlashCommands.length + idx;
															return (
																<button
																	key={prompt.name}
																	type="button"
																	data-highlighted={globalIdx === slashHighlightIndex}
																	className={
																		globalIdx === slashHighlightIndex ? MENU_STYLES.popoverItemActive : MENU_STYLES.popoverItem
																	}
																	onClick={() => executePromptSelection(prompt)}
																	onMouseEnter={() => setSlashHighlightIndex(globalIdx)}
																>
																	<FileText className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
																	<span>
																		{indices && indices.length > 0
																			? highlightMatches(`prompts:${prompt.name}`, indices)
																			: `prompts:${prompt.name}`}
																	</span>
																	<span className={MENU_STYLES.popoverItemDesc} title={prompt.description || 'send saved prompt'}>
																		{prompt.description || 'send saved prompt'}
																	</span>
																</button>
															);
														})}
													</>
												)}
												{/* Skills section */}
												{filteredSkillsForSlashMenu.length > 0 && (
													<>
														<div
															className={`${MENU_STYLES.popoverTitle} ${
																filteredSlashCommands.length > 0 || filteredPromptsForSlashMenu.length > 0
																	? 'mt-2 border-t border-border-menuDivider pt-2'
																	: ''
															}`}
														>
															Skills
														</div>
														{filteredSkillsForSlashMenu.map(({ skill, indices }, idx) => {
															const globalIdx = filteredSlashCommands.length + filteredPromptsForSlashMenu.length + idx;
															return (
																<button
																	key={skill.name}
																	type="button"
																	data-highlighted={globalIdx === slashHighlightIndex}
																	className={
																		globalIdx === slashHighlightIndex ? MENU_STYLES.popoverItemActive : MENU_STYLES.popoverItem
																	}
																	onClick={() => executeSkillSelection(skill)}
																	onMouseEnter={() => setSlashHighlightIndex(globalIdx)}
																>
																	<Zap className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
																	<span>
																		{indices && indices.length > 0
																			? highlightMatches(skill.name, indices)
																			: skill.name}
																	</span>
																	<span className={MENU_STYLES.popoverItemDesc} title={skill.shortDescription || skill.description}>
																		{skill.shortDescription || skill.description}
																	</span>
																</button>
															);
														})}
													</>
												)}
												{/* Empty state */}
												{filteredSlashCommands.length === 0 && filteredPromptsForSlashMenu.length === 0 && filteredSkillsForSlashMenu.length === 0 && (
													<div className={`${MENU_STYLES.popoverItemDesc} px-2 py-1`}>No matching commands, prompts or skills</div>
												)}
											</>
										) : (
											// File search results
											<>
												{fileSearchResults.length > 0 ? (
													fileSearchResults.map((f) => (
														<button
															key={f.path}
															type="button"
															className={MENU_STYLES.popoverItem}
															onClick={() => void addFileAttachment(f)}
														>
															{f.isDirectory ? (
																<Folder className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
															) : (
																<File className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
															)}
															<span className="truncate">{f.path}</span>
														</button>
													))
												) : fileSearchQuery ? (
													<div className={`${MENU_STYLES.popoverItemDesc} px-2 py-1`}>No files found</div>
												) : null}
											</>
										)}
									</div>
									{/* Add image option (only for + menu) */}
									{isAddContextOpen ? (
										<div className="mt-1.5 border-t border-border-menuDivider pt-1.5">
											<button
												type="button"
												className={MENU_STYLES.popoverItem}
												onClick={() => fileInputRef.current?.click()}
											>
												<Image className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
												<span>Add image</span>
											</button>
										</div>
									) : null}
								</div>
							</>
						) : null}

						{/* Attachments display: files only (skill/prompt tags are inline with textarea) */}
						{fileAttachments.length > 0 ? (
							<div className="mb-2 flex flex-wrap gap-1.5">
								{/* File attachments */}
								{fileAttachments.map((f) => (
									<div
										key={f.path}
										className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-bg-panelHover px-2 py-1 text-xs"
									>
										{f.content?.startsWith('data:image') ? (
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

						{/* Hidden file input for image upload */}
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							className="hidden"
							onChange={handleImageUpload}
						/>

						{/* Input area with inline tags for skill/prompt */}
						<div className="flex flex-wrap items-start gap-1.5">
							{/* Selected prompt - inline tag */}
							{selectedPrompt ? (
								<div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">
									<FileText className="h-3.5 w-3.5" />
									<span className="max-w-[160px] truncate">prompts:{selectedPrompt.name}</span>
									<button
										type="button"
										className="rounded p-0.5 hover:bg-blue-500/20"
										onClick={() => setSelectedPrompt(null)}
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							) : null}
							{/* Selected skill - inline tag */}
							{selectedSkill ? (
								<div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
									<Zap className="h-3.5 w-3.5" />
									<span className="max-w-[160px] truncate">{selectedSkill.name}</span>
									<button
										type="button"
										className="rounded p-0.5 hover:bg-primary/20"
										onClick={() => setSelectedSkill(null)}
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							) : null}
							{/* Textarea */}
							<textarea
								ref={textareaRef}
								rows={1}
								className="m-0 h-5 min-w-[100px] flex-1 resize-none overflow-y-auto bg-transparent p-0 text-sm leading-5 outline-none placeholder:text-text-dim"
								placeholder={selectedSkill || selectedPrompt ? '' : 'Ask for follow-up changes'}
								value={input}
								onChange={(e) => {
									const newValue = e.target.value;
									setInput(newValue);

									// Auto-resize textarea
									const textarea = e.target;
									textarea.style.height = 'auto';
									textarea.style.height = `${Math.min(textarea.scrollHeight, 264)}px`;
								}}
								onKeyDown={handleTextareaKeyDown}
								disabled={sending}
							/>
						</div>

						{/* Bottom row: +, /, Auto context, Send */}
						<div className="mt-2 flex items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								{/* + Add Context Button */}
								<button
									type="button"
									className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-bg-panelHover text-text-main hover:border-white/20"
									title="Add context"
									onClick={() => setIsAddContextOpen((v) => !v)}
								>
									<Plus className="h-3.5 w-3.5" />
								</button>

								{/* / Slash Commands Button */}
								<button
									type="button"
									className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-bg-panelHover text-text-main hover:border-white/20"
									title="Commands"
									onClick={() => setIsSlashMenuOpen((v) => !v)}
								>
									<Slash className="h-3.5 w-3.5" />
								</button>

								{/* Auto context toggle */}
								<button
									type="button"
									className={[
										'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] leading-none transition',
										autoContextEnabled
											? 'border-primary/40 bg-primary/10 text-primary'
											: 'border-white/10 bg-bg-panelHover text-text-muted hover:border-white/20',
									].join(' ')}
									onClick={() => setAutoContextEnabled((v) => !v)}
									title={
										autoContext
											? `cwd: ${autoContext.cwd}\nRecent: ${autoContext.recentFiles.length} files\nGit: ${
													autoContext.gitStatus?.branch ?? 'N/A'
											  }`
											: 'Auto context'
									}
								>
									<span>Auto context</span>
									{autoContext?.gitStatus ? (
										<span className="rounded bg-white/10 px-1 py-0.5 text-[10px] leading-none">
											{autoContext.gitStatus.branch}
										</span>
									) : null}
								</button>
							</div>

							{/* Send/Stop button */}
							{activeTurnId && selectedThreadId ? (
								<button
									type="button"
									className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
									onClick={() => void apiClient.codexTurnInterrupt(selectedThreadId, activeTurnId)}
									title="Stop"
								>
									{/* Background circle */}
									<div className="absolute inset-0 rounded-full bg-[#3a3a3a]" />
									{/* Spinning ring - using SVG for better visibility */}
									<svg
										className="absolute inset-0 h-full w-full animate-spin"
										viewBox="0 0 32 32"
									>
										<circle
											cx="16"
											cy="16"
											r="14"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											className="text-white/20"
										/>
										<circle
											cx="16"
											cy="16"
											r="14"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeDasharray="22 66"
											strokeLinecap="round"
											className="text-white/70"
										/>
									</svg>
									{/* Stop icon (red rounded square) */}
									<div className="relative h-3 w-3 rounded-[3px] bg-[#ef4444]" />
								</button>
							) : (
								<button
									type="button"
									className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-bg-panel hover:bg-white disabled:bg-white/30 disabled:text-bg-panel/50"
									onClick={() => void sendMessage()}
									disabled={sending || (input.trim().length === 0 && !selectedSkill && !selectedPrompt)}
									title="Send (Ctrl/Cmd+Enter)"
								>
									<ArrowUp className="h-5 w-5" />
								</button>
							)}
						</div>
					</div>

					<div className="-mx-8 mt-2 flex h-8 items-center justify-between gap-2 bg-bg-panel/40 px-4 text-xs text-text-muted">
						<div className="flex min-w-0 flex-nowrap items-center gap-1">
							{/* Switch mode dropdown */}
							<div className="relative">
								<button
									type="button"
									className={statusBarItemClass(openStatusPopover === 'profile')}
									onClick={() => setOpenStatusPopover((prev) => (prev === 'profile' ? null : 'profile'))}
									title="Switch mode"
								>
									<span className="truncate">
										{approvalPolicy === 'never'
											? 'Agent (full access)'
											: approvalPolicy === 'untrusted'
											? 'Agent'
											: 'Custom'}
									</span>
									<ChevronDown className="h-3 w-3" />
								</button>

								{openStatusPopover === 'profile' ? (
									<div className={`absolute bottom-[28px] left-0 z-50 w-max py-1.5 ${MENU_STYLES.popover}`}>
										<div className={MENU_STYLES.popoverTitle}>Switch mode</div>
										<button
											type="button"
											className={MENU_STYLES.popoverItem}
											onClick={() => {
												void applyApprovalPolicy('untrusted');
												setOpenStatusPopover(null);
											}}
											title="需要用户批准所有操作"
										>
											<Users className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
											<span>Agent</span>
											<Check
												className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${
													approvalPolicy === 'untrusted' ? '' : 'invisible'
												}`}
											/>
										</button>
										<button
											type="button"
											className={MENU_STYLES.popoverItem}
											onClick={() => {
												void applyApprovalPolicy('never');
												setOpenStatusPopover(null);
											}}
											title="自动执行所有操作，无需批准"
										>
											<Zap className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
											<span>Agent (full access)</span>
											<Check
												className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${
													approvalPolicy === 'never' ? '' : 'invisible'
												}`}
											/>
										</button>
										<button
											type="button"
											className={MENU_STYLES.popoverItem}
											onClick={() => {
												void applyApprovalPolicy('on-request');
												setOpenStatusPopover(null);
											}}
											title="使用 config.toml 自定义批准策略"
										>
											<FileText className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
											<span>Custom (config.toml)</span>
											<Check
												className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${
													approvalPolicy === 'on-request' || approvalPolicy === 'on-failure' ? '' : 'invisible'
												}`}
											/>
										</button>
									</div>
								) : null}
							</div>

							<div className="relative">
								<button
									type="button"
									className={statusBarItemClass(openStatusPopover === 'model')}
									onClick={() => {
										setStatusPopoverError(null);
										setOpenStatusPopover((prev) => (prev === 'model' ? null : 'model'));
									}}
									title="model"
								>
									<Box className="h-3.5 w-3.5 text-text-menuLabel" />
									<span className="truncate">{selectedModelInfo?.displayName ?? selectedModel ?? 'model'}</span>
									<ChevronDown className="h-3 w-3" />
								</button>

								{openStatusPopover === 'model' ? (
									<div className={`absolute bottom-[28px] left-0 z-50 w-max py-1.5 ${MENU_STYLES.popover}`}>
										<div className={MENU_STYLES.popoverTitle}>Select model</div>
										<div className="max-h-[40vh] overflow-auto">
											{models.length === 0 ? (
												<div className="px-3 py-1.5 text-[12px] text-text-muted">(unavailable)</div>
											) : (
												models.map((m) => {
													const selected = selectedModel === m.model;
													return (
														<button
															key={m.id}
															type="button"
															className={MENU_STYLES.popoverItem}
															onClick={() => void applyModel(m.model)}
															title={translateModelDesc(m.description)}
														>
															<span>{m.displayName}</span>
															<Check
																className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${selected ? '' : 'invisible'}`}
															/>
														</button>
													);
												})
											)}
											{modelsError ? (
												<div className="px-3 py-1 text-[11px] text-status-warning">{modelsError}</div>
											) : null}
										</div>
									</div>
								) : null}
							</div>

							<div className="relative">
								<button
									type="button"
									className={statusBarItemClass(openStatusPopover === 'approval_policy')}
									onClick={() => {
										setStatusPopoverError(null);
										setOpenStatusPopover((prev) => (prev === 'approval_policy' ? null : 'approval_policy'));
									}}
									title="approval_policy"
								>
									<span className="truncate">{approvalPolicy}</span>
									<ChevronDown className="h-3 w-3" />
								</button>

								{openStatusPopover === 'approval_policy' ? (
									<div className={`absolute bottom-[28px] left-0 z-50 w-max py-1.5 ${MENU_STYLES.popover}`}>
										<div className={MENU_STYLES.popoverTitle}>Approval policy</div>
										<div>
											{(['untrusted', 'on-request', 'on-failure', 'never'] as const).map((policy) => {
												const selected = approvalPolicy === policy;
												const policyTitles: Record<string, string> = {
													untrusted: '不信任模式，所有操作需要批准',
													'on-request': '按需批准，仅在请求时需要批准',
													'on-failure': '失败时批准，仅在操作失败时需要批准',
													never: '完全信任，自动执行所有操作',
												};
												return (
													<button
														key={policy}
														type="button"
														className={MENU_STYLES.popoverItem}
														onClick={() => void applyApprovalPolicy(policy)}
														title={policyTitles[policy]}
													>
														<span>{policy}</span>
														<Check
															className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${selected ? '' : 'invisible'}`}
														/>
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
									className={statusBarItemClass(openStatusPopover === 'model_reasoning_effort')}
									onClick={() => {
										setStatusPopoverError(null);
										setOpenStatusPopover((prev) =>
											prev === 'model_reasoning_effort' ? null : 'model_reasoning_effort'
										);
									}}
									title="model_reasoning_effort"
								>
									{selectedEffort ? (
										reasoningEffortIcon(selectedEffort, 'h-3.5 w-3.5 text-text-menuLabel')
									) : (
										<Brain className="h-3.5 w-3.5 text-text-menuLabel" />
									)}
									<span className="truncate">
										{selectedEffort ? reasoningEffortLabelEn(selectedEffort) : 'Default'}
									</span>
									<ChevronDown className="h-3 w-3" />
								</button>

								{openStatusPopover === 'model_reasoning_effort' ? (
									<div className={`absolute bottom-[28px] left-0 z-50 w-max py-1.5 ${MENU_STYLES.popover}`}>
										<div className={MENU_STYLES.popoverTitle}>Select reasoning</div>
										<div>
											{effortOptions.length === 0 ? (
												<div className="px-3 py-1.5 text-[12px] text-text-muted">Default</div>
											) : (
												effortOptions.map((opt) => {
													const selected = selectedEffort === opt.reasoningEffort;
													return (
														<button
															key={opt.reasoningEffort}
															type="button"
															className={MENU_STYLES.popoverItem}
															onClick={() => void applyReasoningEffort(opt.reasoningEffort)}
															title={translateReasoningDesc(opt.description)}
														>
															{reasoningEffortIcon(opt.reasoningEffort, `${MENU_STYLES.iconSm} text-text-menuLabel`)}
															<span>{reasoningEffortLabelEn(opt.reasoningEffort)}</span>
															<Check
																className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${selected ? '' : 'invisible'}`}
															/>
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

					{statusPopoverError ? <div className="mt-2 text-xs text-status-warning">{statusPopoverError}</div> : null}

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
										<div className="text-sm font-semibold">~/.codex/config.toml</div>
										<div className="mt-1 text-xs text-text-muted">
											Edit Codex configuration directly. Changes apply to future turns.
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
										{configSaving ? 'Saving…' : 'Save'}
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
										<div className="mt-1 text-xs text-text-muted">Sorted by recently updated.</div>
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
										<div className="p-3 text-sm text-text-muted">Loading sessions…</div>
									) : sessions.length === 0 ? (
										<div className="p-3 text-sm text-text-muted">No sessions yet.</div>
									) : (
										<div className="space-y-2">
											{sessions.map((s) => {
												const isSelected = s.id === selectedThreadId;
												return (
													<button
														key={s.id}
														type="button"
														className={[
															'w-full rounded-xl border px-3 py-2 text-left transition',
															isSelected
																? 'border-primary/40 bg-primary/10'
																: 'border-white/10 bg-bg-panelHover hover:border-white/20',
														].join(' ')}
														onClick={() => void selectSession(s.id)}
													>
														<div className="truncate text-sm font-semibold">{s.id}</div>
														<div className="mt-1 truncate text-xs text-text-muted">{s.preview || '—'}</div>
														<div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-dim">
															<span className="truncate">{s.modelProvider}</span>
															<span className="shrink-0">{formatSessionUpdatedAtMs(s)}</span>
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
											<div className="text-sm font-semibold">Default collapse details</div>
											<div className="mt-1 text-xs text-text-muted">
												When enabled, command output & diffs start collapsed (you can always expand).
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

										{diagnosticsError ? (
											<div className="mt-2 text-xs text-status-warning">{diagnosticsError}</div>
										) : null}

										{diagnostics ? (
											<div className="mt-3 space-y-2 text-[11px] text-text-muted">
												<div className="truncate">
													{diagnostics.resolvedCodexBin
														? `resolved codex: ${diagnostics.resolvedCodexBin}`
														: 'resolved codex: (not found)'}
												</div>
												<div className="truncate">
													{diagnostics.envOverride
														? `AGENTMESH_CODEX_BIN: ${diagnostics.envOverride}`
														: 'AGENTMESH_CODEX_BIN: (unset)'}
												</div>
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
												Tip: set <span className="font-mono">AGENTMESH_CODEX_BIN</span> to an absolute path (e.g.{' '}
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
	);
}

export default CodexChat;
