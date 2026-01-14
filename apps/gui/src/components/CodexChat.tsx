import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { message as dialogMessage, open as openDialog } from '@tauri-apps/plugin-dialog';
import {
	ArrowUp,
	AtSign,
	Box,
	BookOpen,
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
	Terminal,
	Trash2,
	Users,
	Wrench,
	X,
	Zap,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { CodeReviewAssistantMessage } from './codex/CodeReviewAssistantMessage';
import { Collapse } from './ui/Collapse';
import {
	parseCodeReviewStructuredOutputFromMessage,
	shouldHideAssistantMessageContent,
} from './codex/assistantMessage';
import type {
	AutoContextInfo,
	CommandAction,
	CodexJsonRpcEvent,
	CodexModelInfo,
	CodexThread,
	CodexThreadItem,
	CodexThreadSummary,
	CodexUserInput,
	CustomPrompt,
	FileAttachment,
	FileInfo,
	McpContentBlock,
	McpToolCallError,
	McpToolCallResult,
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
		completed?: boolean;
		renderPlaceholderWhileStreaming?: boolean;
		structuredOutput?: ReturnType<typeof parseCodeReviewStructuredOutputFromMessage> | null;
		reasoningSummary?: string[];
		reasoningContent?: string[];
	}
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
		changes: Array<{ path: string; diff?: string; kind?: unknown }>;
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

type CodexChatSettings = {
	showReasoning: boolean;
	defaultCollapseDetails: boolean;
};

const SETTINGS_STORAGE_KEY = 'agentmesh.codexChat.settings.v2';
const SIDEBAR_WIDTH_PX = 48 * 0.7;
const SIDEBAR_ICON_BUTTON_PX = SIDEBAR_WIDTH_PX * 0.7;

function loadCodexChatSettings(): CodexChatSettings {
	const defaults: CodexChatSettings = {
		showReasoning: true,
		defaultCollapseDetails: true,
	};

	if (typeof window === 'undefined') return defaults;
	try {
		const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
		if (!raw) return defaults;
		const parsed = JSON.parse(raw) as Partial<CodexChatSettings>;
		return {
			showReasoning: typeof parsed.showReasoning === 'boolean' ? parsed.showReasoning : defaults.showReasoning,
			defaultCollapseDetails:
				typeof parsed.defaultCollapseDetails === 'boolean'
					? parsed.defaultCollapseDetails
					: defaults.defaultCollapseDetails,
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

// ============================================================================
// VS Code Codex Plugin Parity: Command Parsing, Heading Extraction, MCP Preview
// ============================================================================

type ParsedCmdType = 'search' | 'read' | 'list_files' | 'format' | 'test' | 'lint' | 'noop' | 'unknown';

interface ParsedCmd {
	type: ParsedCmdType;
	cmd: string;
	name?: string; // file name for read
	query?: string; // search query
	path?: string; // optional path hint
}

function stripOuterQuotes(value: string): string {
	const trimmed = value.trim();
	const isSingleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'");
	const isDoubleQuoted = trimmed.startsWith('"') && trimmed.endsWith('"');
	if (!isSingleQuoted && !isDoubleQuoted) return trimmed;
	let inner = trimmed.slice(1, -1);
	if (isSingleQuoted) {
		inner = inner.replace(/'\"'\"'/g, "'");
	} else {
		inner = inner.replace(/\\"/g, '"');
	}
	return inner;
}

function unwrapShellCommand(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) return trimmed;
	const patterns = [
		/^(?:\/bin\/)?(?:bash|zsh|sh)\s+-lc\s+([\s\S]+)$/i,
		/^(?:\/bin\/)?(?:bash|zsh|sh)\s+(?:-l\s+)?-c\s+([\s\S]+)$/i,
	];
	for (const pattern of patterns) {
		const match = trimmed.match(pattern);
		if (match && match[1]) {
			return stripOuterQuotes(match[1]);
		}
	}
	return trimmed;
}

function normalizeShellCommand(command: string): string {
	const unwrapped = unwrapShellCommand(command);
	return unwrapped.replace(/^\$\s+/, '').trim();
}

function splitPipeSegments(command: string): string[] {
	const segments: string[] = [];
	let buffer = '';
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < command.length; i += 1) {
		const char = command[i];
		if (char === "'" && !inDouble) {
			inSingle = !inSingle;
			buffer += char;
			continue;
		}
		if (char === '"' && !inSingle) {
			inDouble = !inDouble;
			buffer += char;
			continue;
		}
		if (char === '|' && !inSingle && !inDouble) {
			const trimmed = buffer.trim();
			if (trimmed) segments.push(trimmed);
			buffer = '';
			continue;
		}
		buffer += char;
	}
	const tail = buffer.trim();
	if (tail) segments.push(tail);
	return segments;
}

function extractLastPathArg(command: string): string | undefined {
	const match = command.match(/(?:^|\s)([^\s"']+|"[^"]+"|'[^']+')\s*$/);
	if (!match) return undefined;
	const token = stripOuterQuotes(match[1]);
	if (!token || token.startsWith('-')) return undefined;
	return token;
}

function parseCommandSingle(cmdString: string): ParsedCmd {
	const cmd = cmdString.trim();
	if (!cmd) {
		return { type: 'unknown', cmd: '' };
	}
	const lowerCmd = cmd.toLowerCase();

	// Pattern: grep/rg/ag search commands
	if (/^(grep|rg|ag|ack)\s/.test(lowerCmd)) {
		const match = cmd.match(/^(?:grep|rg|ag|ack)\s+(?:-[^\s]+\s+)*['"]?([^'"]+)['"]?\s*(.*)$/i);
		if (match) {
			return { type: 'search', cmd, query: match[1], path: match[2] || undefined };
		}
		return { type: 'search', cmd };
	}

	// Pattern: find command
	if (/^find\s/.test(lowerCmd)) {
		const match = cmd.match(/-name\s+['"]?([^'"]+)['"]?/i);
		if (match) {
			return { type: 'search', cmd, query: match[1] };
		}
		return { type: 'list_files', cmd };
	}

	// Pattern: ls/dir/tree commands
	if (/^(ls|dir|tree)\b/.test(lowerCmd)) {
		const parts = cmd
			.split(/\s+/)
			.slice(1)
			.filter((part) => part && !part.startsWith('-'));
		const path = parts.length > 0 ? parts[0] : undefined;
		return { type: 'list_files', cmd, path };
	}

	// Pattern: cat/head/tail/less/more (read file)
	if (/^(cat|head|tail|less|more|bat)\s/.test(lowerCmd)) {
		const match = cmd.match(/^(?:cat|head|tail|less|more|bat)\s+(?:-[^\s]+\s+)*(.+)$/i);
		if (match) {
			const name = match[1].split(/\s+/)[0]; // first argument as filename
			return { type: 'read', cmd, name };
		}
		return { type: 'read', cmd };
	}

	// Pattern: sed/nl (read file; ignore in-place edits)
	if (/^sed\b/.test(lowerCmd)) {
		const hasInPlace = /(^|\s)-i\b/.test(lowerCmd) || /--in-place\b/.test(lowerCmd);
		if (hasInPlace) {
			return { type: 'unknown', cmd };
		}
		const name = extractLastPathArg(cmd);
		if (name) return { type: 'read', cmd, name };
		return { type: 'unknown', cmd };
	}
	if (/^nl\b/.test(lowerCmd)) {
		const name = extractLastPathArg(cmd);
		if (name) return { type: 'read', cmd, name };
		return { type: 'unknown', cmd };
	}

	// Pattern: format/prettier/black/gofmt
	if (/^(prettier|black|gofmt|rustfmt|clang-format|autopep8)\b/.test(lowerCmd)) {
		return { type: 'format', cmd };
	}

	// Pattern: test commands
	if (/^(npm\s+test|yarn\s+test|pytest|jest|cargo\s+test|go\s+test|rspec|mocha)\b/.test(lowerCmd)) {
		return { type: 'test', cmd };
	}

	// Pattern: lint commands
	if (/^(eslint|pylint|flake8|clippy|golint|tslint|rubocop)\b/.test(lowerCmd)) {
		return { type: 'lint', cmd };
	}

	// Pattern: echo/true/: (noop)
	if (/^(echo|true|:)\b/.test(lowerCmd)) {
		return { type: 'noop', cmd };
	}

	return { type: 'unknown', cmd };
}

/**
 * Parse a command string to extract semantic type and parameters.
 * Matches VS Code Codex plugin's command classification logic.
 */
function parseCommand(cmdString: string): ParsedCmd {
	const cmd = normalizeShellCommand(cmdString ?? '');
	if (!cmd) return { type: 'unknown', cmd: '' };
	const segments = splitPipeSegments(cmd);
	if (segments.length > 1) {
		for (const segment of segments) {
			const parsed = parseCommandSingle(segment);
			if (parsed.type !== 'unknown') return parsed;
		}
	}
	return parseCommandSingle(cmd);
}

function normalizeCommandActions(value: unknown): CommandAction[] {
	if (!Array.isArray(value)) return [];
	const out: CommandAction[] = [];
	for (const action of value) {
		if (!isRecord(action)) continue;
		const type = safeString(action.type);
		const command = safeString(action.command);
		if (!type || !command) continue;
		if (type === 'read') {
			const name = safeString(action.name);
			const path = safeString(action.path) || name;
			if (!name) continue;
			out.push({ type: 'read', command, name, path });
			continue;
		}
		if (type === 'listFiles') {
			const path = safeString(action.path) || undefined;
			out.push({ type: 'listFiles', command, path: path || undefined });
			continue;
		}
		if (type === 'search') {
			const query = safeString(action.query) || undefined;
			const path = safeString(action.path) || undefined;
			out.push({ type: 'search', command, query, path });
			continue;
		}
		if (type === 'unknown') {
			out.push({ type: 'unknown', command });
		}
	}
	return out;
}

function parsedCmdFromAction(action: CommandAction): ParsedCmd {
	switch (action.type) {
		case 'read':
			return { type: 'read', cmd: action.command, name: action.name, path: action.path };
		case 'listFiles':
			return { type: 'list_files', cmd: action.command, path: action.path ?? undefined };
		case 'search':
			return {
				type: 'search',
				cmd: action.command,
				query: action.query ?? undefined,
				path: action.path ?? undefined,
			};
		case 'unknown':
		default:
			return { type: 'unknown', cmd: action.command };
	}
}

function resolveParsedCmd(command: string, commandActions?: CommandAction[]): ParsedCmd {
	const actions = Array.isArray(commandActions) ? commandActions : [];
	if (actions.length > 0) {
		return parsedCmdFromAction(actions[0]);
	}
	return parseCommand(command);
}

function normalizeMcpResult(value: unknown): McpToolCallResult | null {
	if (!isRecord(value)) return null;
	const contentRaw = value.content;
	const content = Array.isArray(contentRaw) ? (contentRaw as McpContentBlock[]) : [];
	const structuredContent =
		(value as { structuredContent?: unknown; structured_content?: unknown }).structuredContent ??
		(value as { structuredContent?: unknown; structured_content?: unknown }).structured_content ??
		null;
	return { content, structuredContent };
}

function normalizeMcpError(value: unknown): McpToolCallError | null {
	if (!isRecord(value)) return null;
	const message = safeString(value.message);
	if (!message) return null;
	return { message };
}

/**
 * Generate a smart summary for a parsed command.
 * Matches VS Code Codex plugin's CmdSummaryText behavior.
 */
function getCmdSummary(
	parsed: ParsedCmd,
	isFinished: boolean,
	rawCommand?: string
): { prefix: string; content: string } {
	switch (parsed.type) {
		case 'search':
			if (parsed.query && parsed.path) {
				return {
					prefix: isFinished ? 'Searched for' : 'Searching for',
					content: `${parsed.query} in ${parsed.path}`,
				};
			}
			if (parsed.query) {
				return {
					prefix: isFinished ? 'Searched for' : 'Searching for',
					content: parsed.query,
				};
			}
			return {
				prefix: isFinished ? 'Searched for' : 'Searching for',
				content: 'files',
			};
		case 'read':
			return {
				prefix: isFinished ? 'Read' : 'Reading',
				content: parsed.name || 'file',
			};
		case 'list_files':
			if (parsed.path) {
				return {
					prefix: isFinished ? 'Listed files in' : 'Listing files in',
					content: parsed.path,
				};
			}
			return {
				prefix: isFinished ? 'Explored' : 'Exploring',
				content: 'files',
			};
		case 'format':
		case 'test':
		case 'lint':
		case 'noop':
		case 'unknown':
		default:
			return {
				prefix: isFinished ? 'Ran' : 'Running',
				content: rawCommand?.trim() || parsed.cmd,
			};
	}
}

function normalizeCommandOutput(output: string | null): string {
	if (!output) return '';
	const lines = output.replace(/\r\n?/g, '\n').split('\n');
	const filtered = lines.filter((line) => {
		const trimmed = line.trim();
		if (!trimmed) return true;
		if (/^Chunk ID:/.test(trimmed)) return false;
		if (/^Wall time:/.test(trimmed)) return false;
		if (/^Process exited with code/.test(trimmed)) return false;
		if (/^Original token count:/.test(trimmed)) return false;
		if (/^Output:\s*$/.test(trimmed)) return false;
		return true;
	});
	let result = filtered.join('\n');
	result = result.replace(/^\s*\n+/, '');
	return result;
}

function formatCommandLine(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) return '';
	const escaped = trimmed.replace(/'/g, `'\"'\"'`);
	return `$ '${escaped}'`;
}

function prefixCommandLine(command: string, output: string | null): string {
	const cleaned = normalizeCommandOutput(output);
	const cmdLine = formatCommandLine(command);
	if (!cmdLine) return cleaned;
	const lines = cleaned.replace(/\r\n?/g, '\n').split('\n');
	const firstNonEmpty = lines.find((line) => line.trim() !== '');
	if (firstNonEmpty && firstNonEmpty.startsWith('$')) return cleaned;
	return cleaned ? `${cmdLine}\n${cleaned}` : cmdLine;
}

/**
 * Extract heading from markdown content.
 * Matches VS Code Codex plugin's useExtractHeading behavior.
 */
function extractHeadingFromMarkdown(text: string): { heading: string | null; body: string } {
	if (!text) return { heading: null, body: '' };

	const lines = text.split('\n');
	let firstIdx = 0;
	while (firstIdx < lines.length && lines[firstIdx]?.trim() === '') {
		firstIdx += 1;
	}
	const firstLine = lines[firstIdx]?.trim() || '';
	const secondLine = lines[firstIdx + 1]?.trim() || '';

	// Check for markdown heading: # Heading
	if (firstLine.startsWith('#')) {
		const heading = firstLine.replace(/^#+\s*/, '').trim();
		const body = lines.slice(firstIdx + 1).join('\n').trim();
		return { heading: heading || null, body };
	}

	// Check for bold heading: **Heading**
	const boldMatch = firstLine.match(/^\*\*(.+)\*\*$/);
	if (boldMatch) {
		const heading = boldMatch[1].trim();
		const body = lines.slice(firstIdx + 1).join('\n').trim();
		return { heading: heading || null, body };
	}

	// Check for setext-style heading
	if (firstLine && (secondLine.match(/^=+$/) || secondLine.match(/^-+$/))) {
		const heading = firstLine.trim();
		const body = lines.slice(firstIdx + 2).join('\n').trim();
		return { heading: heading || null, body };
	}

	return { heading: null, body: text };
}

/**
 * Format MCP tool arguments for preview.
 * Matches VS Code Codex plugin's formatArgumentsPreview behavior.
 */
function truncatePreview(value: string, max = 60): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
	return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function formatPrimitive(value: unknown): string {
	if (typeof value === 'string') return truncatePreview(JSON.stringify(value));
	if (value == null) return 'null';
	return String(value);
}

function stringifyJsonSafe(value: unknown, indent = 2): string {
	try {
		return (
			JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val), indent) ?? 'null'
		);
	} catch {
		try {
			return String(value);
		} catch {
			return '';
		}
	}
}

function formatMcpArgsPreview(args: unknown): string {
	if (args == null) return '';
	if (typeof args !== 'object' || Array.isArray(args)) {
		return truncatePreview(String(args));
	}

	try {
		const values = Object.values(args as Record<string, unknown>);
		if (values.length === 0) return '';
		const first = values[0];
		if (values.length === 1 && isPrimitive(first)) return formatPrimitive(first);
		const json = stringifyJsonSafe(args);
		return truncatePreview(json);
	} catch {
		return '';
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
	const leadingClass = dense ? 'leading-[1.35]' : 'leading-relaxed';
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
						p: ({ children }) => <p className={`${paragraphClass} text-text-muted`}>{children}</p>,
						ul: ({ children }) => <ul className={`${listClass} list-disc pl-5 text-text-muted`}>{children}</ul>,
						ol: ({ children }) => <ol className={`${listClass} list-decimal pl-5 text-text-muted`}>{children}</ol>,
						li: ({ children }) => <li className="my-0.5 text-text-muted">{children}</li>,
						pre: ({ children }) => (
							<pre
								className={`${preClass} whitespace-pre-wrap break-words rounded-lg bg-black/30 px-3 py-2 text-[11px] leading-snug text-text-muted`}
							>
								{children}
							</pre>
						),
						code: ({ className, children }) => {
							const isBlock = typeof className === 'string' && className.includes('language-');
							return !isBlock ? (
								<code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px] text-text-muted">
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

type DiffLineKind = 'insert' | 'delete' | 'context' | 'ellipsis';

type ParsedDiffLine = {
	kind: DiffLineKind;
	text: string;
	lineNumber?: number;
};

type ParsedDiff = {
	lines: ParsedDiffLine[];
	added: number;
	removed: number;
	lineNumberWidth: number;
};

type ParsedFileChangeKind = {
	type: 'add' | 'delete' | 'update';
	movePath?: string;
};

type DiffReviewChange = {
	path: string;
	movePath?: string;
	kind: ParsedFileChangeKind;
	diff: string;
	parsed: ParsedDiff;
};

type FileChangeSummary = {
	id: string;
	titlePrefix: string;
	titleContent: string;
	totalAdded: number;
	totalRemoved: number;
	changes: DiffReviewChange[];
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
			return 'text-text-muted';
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

function parseUnifiedDiff(diff: string): ParsedDiff {
	const rawLines = diff.split(/\r?\n/);
	let oldLine = 0;
	let newLine = 0;
	let sawHunk = false;
	let added = 0;
	let removed = 0;
	let maxLineNumber = 0;
	const lines: ParsedDiffLine[] = [];
	let inHunk = false;

	const pushLine = (kind: DiffLineKind, text: string, lineNumber?: number) => {
		if (typeof lineNumber === 'number') {
			maxLineNumber = Math.max(maxLineNumber, lineNumber);
		}
		lines.push({ kind, text, lineNumber });
	};

	for (const raw of rawLines) {
		const line = raw.replace(/\r$/, '');
		const hunkMatch = line.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
		if (hunkMatch) {
			if (sawHunk) {
				pushLine('ellipsis', '⋮');
			}
			sawHunk = true;
			inHunk = true;
			oldLine = Number(hunkMatch[1]);
			newLine = Number(hunkMatch[2]);
			continue;
		}

		if (!inHunk) {
			continue;
		}

		if (line.startsWith('+') && !line.startsWith('+++')) {
			const text = line.slice(1);
			pushLine('insert', text, newLine);
			newLine += 1;
			added += 1;
			continue;
		}
		if (line.startsWith('-') && !line.startsWith('---')) {
			const text = line.slice(1);
			pushLine('delete', text, oldLine);
			oldLine += 1;
			removed += 1;
			continue;
		}
		if (line.startsWith(' ')) {
			const text = line.slice(1);
			pushLine('context', text, newLine);
			oldLine += 1;
			newLine += 1;
			continue;
		}
	}

	if (!sawHunk) {
		let fallbackLine = 1;
		for (const raw of rawLines) {
			const line = raw.replace(/\r$/, '');
			if (line.startsWith('+') && !line.startsWith('+++')) {
				pushLine('insert', line.slice(1), fallbackLine);
				fallbackLine += 1;
				added += 1;
				continue;
			}
			if (line.startsWith('-') && !line.startsWith('---')) {
				pushLine('delete', line.slice(1), fallbackLine);
				fallbackLine += 1;
				removed += 1;
				continue;
			}
			if (line.startsWith(' ')) {
				pushLine('context', line.slice(1), fallbackLine);
				fallbackLine += 1;
			}
		}
	}

	return {
		lines,
		added,
		removed,
		lineNumberWidth: maxLineNumber.toString().length || 1,
	};
}

function parseFileChangeKind(kind: unknown): ParsedFileChangeKind {
	const fallback: ParsedFileChangeKind = { type: 'update' };
	if (!kind) return fallback;
	if (typeof kind === 'string') {
		const lower = kind.toLowerCase();
		if (lower === 'add' || lower === 'delete' || lower === 'update') {
			return { type: lower as ParsedFileChangeKind['type'] };
		}
		return fallback;
	}
	if (!isRecord(kind)) return fallback;
	const rawType = safeString((kind as { type?: unknown }).type).toLowerCase();
	if (rawType !== 'add' && rawType !== 'delete' && rawType !== 'update') return fallback;
	const movePath =
		safeString((kind as { move_path?: unknown }).move_path) ||
		safeString((kind as { movePath?: unknown }).movePath) ||
		undefined;
	if (rawType === 'update' && movePath) {
		return { type: 'update', movePath };
	}
	return { type: rawType as ParsedFileChangeKind['type'] };
}

function parseDiffForChange(diff: string, kind: ParsedFileChangeKind): ParsedDiff {
	const parsed = parseUnifiedDiff(diff);
	if (parsed.lines.length > 0 || !diff) return parsed;
	if (kind.type !== 'add' && kind.type !== 'delete') return parsed;

	const rawLines = diff.split(/\r?\n/);
	const trimmedLines =
		rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
			? rawLines.slice(0, -1)
			: rawLines;
	const contentLines = trimmedLines.filter(
		(line) =>
			!(
				line.startsWith('*** ') ||
				line.startsWith('+++') ||
				line.startsWith('---') ||
				line.startsWith('Index: ')
			)
	);
	let lineNumber = 1;
	const lines: ParsedDiffLine[] = [];
	for (const line of contentLines) {
		lines.push({
			kind: kind.type === 'add' ? 'insert' : 'delete',
			text: line,
			lineNumber,
		});
		lineNumber += 1;
	}
	const count = contentLines.length;
	return {
		lines,
		added: kind.type === 'add' ? count : 0,
		removed: kind.type === 'delete' ? count : 0,
		lineNumberWidth: Math.max(1, count).toString().length,
	};
}

function formatDiffPath(path: string, movePath?: string) {
	if (movePath && movePath !== path) return `${path} → ${movePath}`;
	return path;
}

function buildFileChangeSummary(entry: Extract<ChatEntry, { kind: 'fileChange' }>): FileChangeSummary {
	const changes: DiffReviewChange[] = entry.changes.map((change) => {
		const kind = parseFileChangeKind(change.kind);
		const diff = change.diff ?? '';
		const parsed = parseDiffForChange(diff, kind);
		return {
			path: change.path,
			movePath: kind.movePath,
			kind,
			diff,
			parsed,
		};
	});
	const totalAdded = changes.reduce((sum, change) => sum + change.parsed.added, 0);
	const totalRemoved = changes.reduce((sum, change) => sum + change.parsed.removed, 0);
	const fileCount = changes.length;
	const single = fileCount === 1;
	const primaryKind = single ? changes[0]?.kind.type : 'update';
	const titlePrefix =
		primaryKind === 'add' ? 'Added' : primaryKind === 'delete' ? 'Deleted' : 'Edited';
	const titleContent = single
		? formatDiffPath(changes[0]?.path ?? 'file', changes[0]?.movePath)
		: `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
	return {
		id: entry.id,
		titlePrefix,
		titleContent,
		totalAdded,
		totalRemoved,
		changes,
	};
}

function DiffCountBadge({ added, removed }: { added: number; removed: number }) {
	return (
		<span className="inline-flex items-center gap-1 text-[10px] font-medium">
			<span className="text-green-400">+{added}</span>
			<span className="text-red-400">-{removed}</span>
		</span>
	);
}

function fileChangeVerb(kind: ParsedFileChangeKind, isPending: boolean): string {
	if (isPending) {
		return kind.type === 'add' ? 'Adding' : kind.type === 'delete' ? 'Deleting' : 'Editing';
	}
	return kind.type === 'add' ? 'Added' : kind.type === 'delete' ? 'Deleted' : 'Edited';
}

function FileChangeEntryCard({
	change,
	isPending,
	defaultCollapsed,
}: {
	change: DiffReviewChange;
	isPending: boolean;
	defaultCollapsed: boolean;
}) {
	const initialOpen = isPending ? true : !defaultCollapsed;
	const [open, setOpen] = useState(initialOpen);
	const verb = fileChangeVerb(change.kind, isPending);
	const label = formatDiffPath(change.path, change.movePath);
	const copyText = change.diff ? `${label}\n${change.diff}`.trim() : label;
	const hasDiff = change.parsed.lines.length > 0;

	return (
			<div className={['am-block', open ? 'am-block-open' : ''].join(' ')}>
			<div
				className="am-shell-header group"
				onClick={() => setOpen((prev) => !prev)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setOpen((prev) => !prev);
					}
				}}
			>
				<div className="min-w-0 flex items-center gap-2 text-text-main/90">
					<span className="shrink-0 text-text-menuLabel">{verb}</span>
					<span className="truncate font-mono text-[12px]">{label}</span>
					<DiffCountBadge added={change.parsed.added} removed={change.parsed.removed} />
				</div>
				<div className="flex items-center gap-1">
					{copyText ? (
						<button
							type="button"
							className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
							title="Copy diff"
							onClick={(ev) => {
								ev.stopPropagation();
								void navigator.clipboard.writeText(copyText);
							}}
						>
							<Copy className="h-3 w-3" />
						</button>
					) : null}
					<button
						type="button"
						className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
						title={open ? 'Collapse' : 'Expand'}
						onClick={(ev) => {
							ev.stopPropagation();
							setOpen((prev) => !prev);
						}}
					>
						<ChevronRight
							className={[
								'h-3 w-3 transition-transform duration-200',
								open ? 'rotate-90' : '',
							].join(' ')}
						/>
					</button>
				</div>
			</div>
			<Collapse open={open} innerClassName="pt-0">
				<div className="am-shell">
					<div className="am-shell-scroll am-scroll-fade">
						{hasDiff ? (
							<div className="space-y-0.5">{renderDiffLines(change.parsed)}</div>
						) : (
							<div className="text-[10px] italic text-text-muted">No diff content</div>
						)}
					</div>
				</div>
			</Collapse>
		</div>
	);
}

function renderDiffLines(parsed: ParsedDiff): React.ReactNode {
	if (!parsed.lines.length) return null;
	const gutterWidth = Math.max(parsed.lineNumberWidth, 1);
	return (
		<div className="space-y-0.5">
			{parsed.lines.map((line, idx) => {
				if (line.kind === 'ellipsis') {
					return (
						<div key={`diff-ellipsis-${idx}`} className="text-[10px] text-text-muted/70">
							⋮
						</div>
					);
				}
				const lineNo = line.lineNumber ?? 0;
				const lineClass =
					line.kind === 'insert' ? 'text-green-400' : line.kind === 'delete' ? 'text-red-400' : 'text-text-muted';
				return (
					<div
						key={`diff-${idx}`}
						className="grid font-mono text-[11px] leading-snug"
						style={{ gridTemplateColumns: `${gutterWidth}ch 2ch 1fr` }}
					>
						<span className="text-text-muted/60">{String(lineNo).padStart(gutterWidth, ' ')}</span>
						<span className={lineClass}>{line.kind === 'insert' ? '+' : line.kind === 'delete' ? '-' : ' '}</span>
						<span className={`${lineClass} whitespace-pre`}>{line.text}</span>
					</div>
				);
			})}
		</div>
	);
}

function normalizeMcpContentBlock(block: unknown): McpContentBlock | null {
	if (!isRecord(block)) return null;
	const type = safeString(block.type);
	if (!type) return null;
	return block as McpContentBlock;
}

function mcpContentToText(blocks: unknown[]): string {
	const parts: string[] = [];
	for (const raw of blocks) {
		const block = normalizeMcpContentBlock(raw);
		if (!block) {
			const fallback = stringifyJsonSafe(raw);
			if (fallback) parts.push(fallback);
			continue;
		}
		if (block.type === 'text') {
			parts.push(block.text);
			continue;
		}
		if (block.type === 'resource_link') {
			const title = block.title || block.name || '';
			const uri = block.uri || '';
			parts.push([title, uri].filter(Boolean).join('\n'));
			continue;
		}
		if (block.type === 'resource' || block.type === 'embedded_resource') {
			const resource = block.resource ?? ({} as { uri?: string; text?: string; blob?: string });
			if (resource.text) {
				parts.push(resource.text);
			} else if (resource.blob) {
				parts.push(`[embedded resource blob: ${resource.blob.length} bytes]`);
			} else if (resource.uri) {
				parts.push(resource.uri);
			}
			continue;
		}
		if (block.type === 'image' || block.type === 'audio') {
			const mime = block.mimeType || '';
			const size = block.data?.length ?? 0;
			parts.push(`[${block.type} ${mime} ${size} bytes]`);
			continue;
		}
		const fallback = stringifyJsonSafe(block);
		if (fallback) parts.push(fallback);
	}
	return parts.filter(Boolean).join('\n\n');
}

function renderMcpContentBlocks(blocks: unknown[]): React.ReactNode {
	if (!Array.isArray(blocks) || blocks.length === 0) return null;
	return (
		<div className="space-y-2 whitespace-normal font-sans text-[11px] text-text-muted">
			{blocks.map((raw, idx) => {
				const block = normalizeMcpContentBlock(raw);
				if (!block) {
					return (
						<pre key={`mcp-raw-${idx}`} className="whitespace-pre-wrap break-words rounded-md bg-white/5 px-2 py-1 text-[10px]">
							{stringifyJsonSafe(raw)}
						</pre>
					);
				}
				if (block.type === 'text') {
					return (
						<ChatMarkdown key={`mcp-text-${idx}`} text={block.text} className="text-[11px] text-text-muted" dense />
					);
				}
				if (block.type === 'image') {
					const mime = block.mimeType || 'image/png';
					const src = `data:${mime};base64,${block.data ?? ''}`;
					return (
						<img
							key={`mcp-image-${idx}`}
							className="max-h-48 w-max max-w-full rounded-md object-contain"
							src={src}
							alt=""
						/>
					);
				}
				if (block.type === 'audio') {
					const mime = block.mimeType || 'audio/mpeg';
					const src = `data:${mime};base64,${block.data ?? ''}`;
					return (
						<audio key={`mcp-audio-${idx}`} className="w-full" controls src={src} preload="metadata" />
					);
				}
				if (block.type === 'resource_link') {
					const title = block.title || block.name;
					return (
						<div key={`mcp-link-${idx}`} className="space-y-1 rounded-md bg-white/5 px-2 py-1">
							<div className="text-[10px] font-medium text-text-muted">{title}</div>
							{block.description ? (
								<div className="text-[10px] leading-relaxed text-text-muted">{block.description}</div>
							) : null}
							<a
								className="block break-all text-[10px] text-blue-400 underline"
								href={block.uri}
								target="_blank"
								rel="noreferrer"
							>
								{block.uri}
							</a>
							{block.mimeType ? <div className="text-[9px] text-text-muted">{block.mimeType}</div> : null}
						</div>
					);
				}
				if (block.type === 'resource' || block.type === 'embedded_resource') {
					const resource = block.resource ?? { uri: '' };
					const mimeType = resource.mimeType ?? '';
					const text = resource.text ?? '';
					const blob = resource.blob ?? '';
					return (
						<div key={`mcp-resource-${idx}`} className="space-y-1 rounded-md bg-white/5 px-2 py-1">
							{resource.uri ? (
								<div className="text-[10px] text-text-muted">
									<span className="font-medium">URI:</span>{' '}
									<span className="break-all text-text-muted">{resource.uri}</span>
								</div>
							) : null}
							{mimeType ? <div className="text-[9px] text-text-muted">MIME: {mimeType}</div> : null}
							{text ? (
								<pre className="whitespace-pre-wrap break-words rounded-md bg-black/20 px-2 py-1 text-[10px] text-text-muted">
									{text}
								</pre>
							) : blob ? (
								<div className="text-[10px] text-text-muted">Embedded binary ({blob.length} bytes)</div>
							) : null}
						</div>
					);
				}
				return (
					<pre key={`mcp-unknown-${idx}`} className="whitespace-pre-wrap break-words rounded-md bg-white/5 px-2 py-1 text-[10px]">
						{stringifyJsonSafe(block)}
					</pre>
				);
			})}
		</div>
	);
}

// 通用 Activity Block 组件
type ActivityContentVariant = 'plain' | 'markdown' | 'ansi';

interface ActivityBlockProps {
	/** 标题前缀，如 "Ran", "Edited" */
	titlePrefix: string;
	/** 标题主要内容 */
	titleContent: string;
	/** 标题是否使用等宽字体 */
	titleMono?: boolean;
	/** 标题右侧额外操作 */
	summaryActions?: React.ReactNode;
	/** 状态文本 */
	status?: string;
	/** 复制内容 */
	copyContent: string;
	/** 内容渲染类型 */
	contentVariant?: ActivityContentVariant;
	/** 内容是否强制等宽字体 */
	contentMono?: boolean;
	/** 内容区域额外样式 */
	contentClassName?: string;
	/** 是否可折叠 */
	collapsible?: boolean;
	/** 是否已折叠 */
	collapsed?: boolean;
	/** 切换折叠状态 */
	onToggleCollapse?: () => void;
	/** 内容区域 */
	children?: React.ReactNode;
	/** 详情区头部（可选） */
	detailHeader?: React.ReactNode;
	/** 审批信息 */
	approval?: {
		requestId: number;
		reason?: string | null;
	};
	/** 审批回调 */
	onApprove?: (requestId: number, decision: 'accept' | 'decline') => void;
	/** 左侧图标（可选） */
	icon?: React.ReactNode;
}

	function ActivityBlock({
		titlePrefix,
		titleContent,
		titleMono = false,
		summaryActions,
		status,
		copyContent,
	contentVariant = 'plain',
	contentMono,
	contentClassName,
		collapsible = false,
		collapsed = true,
		onToggleCollapse,
		children,
		detailHeader,
		approval,
		onApprove,
		icon,
	}: ActivityBlockProps) {
		const [summaryHover, setSummaryHover] = useState(false);
		const [didCopy, setDidCopy] = useState(false);
		const isStringChild = typeof children === 'string';
		const effectiveVariant: ActivityContentVariant = contentVariant;
		const useMono = contentMono ?? effectiveVariant === 'ansi';
		const contentNode = (() => {
			if (!isStringChild) return children;
			if (effectiveVariant === 'markdown') {
				return (
					<ChatMarkdown
						text={children}
						className="text-[11px] text-text-muted"
						dense
					/>
				);
			}
		if (effectiveVariant === 'ansi') {
			return renderAnsiText(children);
		}
		return children;
	})();
		const showStatus = status && status !== 'completed';
		const open = !collapsible || !collapsed;
		const showOpenBorder = collapsible && open;

				return (
					<div
						className={[
							'min-w-0 am-block',
							showOpenBorder ? 'am-block-open' : '',
							summaryHover ? 'am-block-hover' : '',
						].join(' ')}
					>
				{/* Summary row (compact) */}
				<div
					className={[
						'am-row group flex min-w-0 items-center justify-between gap-2',
						collapsible && onToggleCollapse ? 'cursor-pointer' : '',
					].join(' ')}
					role={collapsible && onToggleCollapse ? 'button' : undefined}
					tabIndex={collapsible && onToggleCollapse ? 0 : undefined}
					onMouseEnter={() => setSummaryHover(true)}
					onMouseLeave={() => {
						setSummaryHover(false);
						setDidCopy(false);
					}}
					onFocus={() => setSummaryHover(true)}
					onBlur={() => {
						setSummaryHover(false);
						setDidCopy(false);
					}}
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
					<div className="min-w-0 flex-1 truncate text-[13px]">
						<span className="inline-flex min-w-0 items-center gap-2">
							{icon ? <span className="shrink-0 text-text-menuDesc">{icon}</span> : null}
							<span className="shrink-0 font-medium text-text-menuLabel">{titlePrefix}</span>
							<span className={['am-row-title truncate text-text-main/90', titleMono ? 'font-mono text-[12px]' : ''].join(' ')}>
								{titleContent}
							</span>
						</span>
				</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{showStatus ? <span className="text-[10px] text-text-menuDesc opacity-80">{status}</span> : null}
					{summaryActions ? <div className="flex items-center gap-2">{summaryActions}</div> : null}
					<button
						type="button"
						className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
						title="Copy content"
						onClick={(ev) => {
								ev.stopPropagation();
								void navigator.clipboard.writeText(copyContent);
								setDidCopy(true);
							}}
						>
							{didCopy ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
						</button>
						{collapsible && onToggleCollapse ? (
							<button
								type="button"
								className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
								title={open ? 'Collapse' : 'Expand'}
								onClick={(ev) => {
									ev.stopPropagation();
									onToggleCollapse();
								}}
							>
								<ChevronRight
									className={[
										'h-3 w-3 transition-transform duration-200',
										open ? 'rotate-90' : '',
									].join(' ')}
								/>
							</button>
						) : null}
				</div>
			</div>

			{/* Details (only when expanded) */}
			{children ? (
				<Collapse open={open} innerClassName="pt-0">
					<div className="am-shell">
						{detailHeader ? <div className="am-shell-header">{detailHeader}</div> : null}
						<div className="am-shell-scroll am-scroll-fade">
							<div
								className={[
									'min-w-0 text-[12px] leading-[1.5] text-text-muted',
									useMono ? 'font-mono font-medium' : 'font-sans',
									effectiveVariant === 'markdown'
										? 'whitespace-normal'
										: effectiveVariant === 'ansi'
											? 'whitespace-pre'
											: 'whitespace-pre-wrap break-words',
									contentClassName ?? '',
								].join(' ')}
							>
								{contentNode}
							</div>
						</div>
					</div>
				</Collapse>
			) : null}

			{/* Approval (compact, inline) */}
			{approval && onApprove ? (
				<div className="mt-1 flex flex-wrap items-center justify-between gap-2 pl-3 pr-1">
					<div className="min-w-0 text-xs text-text-muted">
						Approval required
						{approval.reason ? `: ${approval.reason}` : ''}.
					</div>
					<div className="flex shrink-0 gap-2">
						<button
							type="button"
							className="rounded-md bg-status-success/20 px-2.5 py-1 text-[11px] font-semibold text-status-success hover:bg-status-success/30 transition-colors"
							onClick={() => onApprove(approval.requestId, 'accept')}
						>
							Approve
						</button>
						<button
							type="button"
							className="rounded-md bg-status-error/15 px-2.5 py-1 text-[11px] font-semibold text-status-error hover:bg-status-error/25 transition-colors"
							onClick={() => onApprove(approval.requestId, 'decline')}
						>
							Decline
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
	popoverTitle: 'px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-text-menuLabel',
	// 弹出菜单选项
	popoverItem:
		'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text-main transition-colors hover:bg-bg-menuItemHover group',
	// 弹出菜单选项（高亮/聚焦）- 与 hover 样式一致
	popoverItemActive:
		'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] bg-bg-menuItemHover text-text-main transition-colors group',
	// 弹出菜单选项描述 - 单行截断，名称后空两格
	popoverItemDesc: 'ml-2.5 shrink-0 max-w-[220px] truncate text-[10px] text-text-menuDesc',
	// 图标尺寸
	iconSm: 'h-3.5 w-3.5',
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function countEntryKinds(entries: ChatEntry[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entry of entries) {
		counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
	}
	return counts;
}

function collectReadingGroupIds(entries: ChatEntry[]): string[] {
	const ids: string[] = [];
	let activeGroup = false;
	for (const entry of entries) {
		if (entry.kind === 'command') {
			const parsed = resolveParsedCmd(entry.command, entry.commandActions);
			if (parsed.type === 'read' && !entry.approval) {
				if (!activeGroup) {
					ids.push(`read-group-${entry.id}`);
					activeGroup = true;
				}
				continue;
			}
		}
		activeGroup = false;
	}
	return ids;
}

type ReadingGroup = {
	kind: 'readingGroup';
	id: string;
	entries: Extract<ChatEntry, { kind: 'command' }>[];
};

type WorkingItem = ChatEntry | ReadingGroup;

type SegmentedWorkingItem =
	| {
			kind: 'exploration';
			id: string;
			status: 'exploring' | 'explored';
			items: WorkingItem[];
			uniqueFileCount: number;
	  }
	| {
			kind: 'item';
			item: WorkingItem;
	  };

function isReadingGroup(item: WorkingItem | undefined): item is ReadingGroup {
	return !!item && 'kind' in item && item.kind === 'readingGroup';
}

function isReasoningEntry(item: WorkingItem): item is Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }> {
	return !isReadingGroup(item) && item.kind === 'assistant' && item.role === 'reasoning';
}

function coerceReasoningParts(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((part) => (typeof part === 'string' ? part : String(part)));
	}
	if (typeof value === 'string') {
		return value.trim() ? [value] : [];
	}
	return [];
}

function normalizeReasoningParts(value: unknown): string[] {
	return coerceReasoningParts(value).filter((part) => part.trim() !== '');
}

function buildReasoningText(summary: string[], content: string[]): string {
	return [...summary, ...content].filter(Boolean).join('\n');
}

function buildReasoningSegmentId(baseId: string, index: number): string {
	return `${baseId}-summary-${index}`;
}

function buildReasoningContentId(baseId: string): string {
	return `${baseId}-content`;
}

function buildReasoningSegments(entry: Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }>): ChatEntry[] {
	const summaryParts = normalizeReasoningParts(entry.reasoningSummary);
	const contentParts = normalizeReasoningParts(entry.reasoningContent);
	const contentText = contentParts.filter(Boolean).join('\n');
	const segments: ChatEntry[] = [];

	if (summaryParts.length > 0) {
		summaryParts.forEach((summary, idx) => {
			const isLast = idx === summaryParts.length - 1;
			const text = isLast && contentText ? `${summary}\n\n${contentText}` : summary;
			segments.push({
				...entry,
				id: buildReasoningSegmentId(entry.id, idx),
				text,
			});
		});
	} else {
		const fallback = contentText || entry.text;
		if (fallback.trim()) {
			segments.push({
				...entry,
				id: buildReasoningContentId(entry.id),
				text: fallback,
			});
		}
	}

	const isStreaming = !!entry.streaming && !entry.completed;
	return segments.map((segment, idx) => {
		const isLast = idx === segments.length - 1;
		const streaming = isStreaming && isLast;
		return {
			...segment,
			streaming,
			completed: streaming ? false : true,
		};
	});
}

function expandReasoningEntries(entries: ChatEntry[]): ChatEntry[] {
	const expanded: ChatEntry[] = [];
	for (const entry of entries) {
		if (entry.kind === 'assistant' && entry.role === 'reasoning') {
			const summaryParts = normalizeReasoningParts(entry.reasoningSummary);
			const contentParts = normalizeReasoningParts(entry.reasoningContent);
			const contentText = contentParts.filter(Boolean).join('\n').trim();

			if (summaryParts.length === 0 && contentText) {
				const last = expanded[expanded.length - 1];
				if (last && last.kind === 'assistant' && last.role === 'reasoning') {
					const mergedText = [last.text?.trim(), contentText].filter(Boolean).join('\n\n');
					const mergedStreaming = !!last.streaming || !!entry.streaming;
					const mergedCompleted = mergedStreaming ? false : !!last.completed && !!entry.completed;
					expanded[expanded.length - 1] = {
						...last,
						text: mergedText,
						streaming: mergedStreaming,
						completed: mergedCompleted,
					};
					continue;
				}
			}

			expanded.push(...buildReasoningSegments(entry));
			continue;
		}
		expanded.push(entry);
	}
	return expanded;
}

function collectReasoningSegmentIds(entries: ChatEntry[]): string[] {
	const ids: string[] = [];
	for (const entry of entries) {
		if (entry.kind === 'assistant' && entry.role === 'reasoning') {
			for (const segment of buildReasoningSegments(entry)) {
				ids.push(segment.id);
			}
		}
	}
	return ids;
}

function mergeReadingEntries(entries: ChatEntry[]): WorkingItem[] {
	const grouped: WorkingItem[] = [];
	for (const entry of entries) {
		if (entry.kind === 'command') {
			const parsed = resolveParsedCmd(entry.command, entry.commandActions);
			if (parsed.type === 'read' && !entry.approval) {
				const last = grouped[grouped.length - 1];
				if (isReadingGroup(last)) {
					last.entries.push(entry);
					continue;
				}
				grouped.push({ kind: 'readingGroup', id: `read-group-${entry.id}`, entries: [entry] });
				continue;
			}
		}
		grouped.push(entry);
	}
	return grouped;
}

function isExplorationStarter(item: WorkingItem): boolean {
	if (isReadingGroup(item)) return true;
	if (item.kind === 'command') {
		const parsed = resolveParsedCmd(item.command, item.commandActions);
		return parsed.type === 'read' || parsed.type === 'search' || parsed.type === 'list_files';
	}
	return false;
}

function isExplorationContinuation(item: WorkingItem): boolean {
	return isExplorationStarter(item) || isReasoningEntry(item);
}

function getUniqueReadingCount(items: WorkingItem[]): number {
	const names = new Set<string>();
	for (const item of items) {
		if (isReadingGroup(item)) {
			for (const entry of item.entries) {
				const parsed = resolveParsedCmd(entry.command, entry.commandActions);
				if (parsed.type === 'read' && parsed.name) names.add(parsed.name);
			}
			continue;
		}
		if (item.kind === 'command') {
			const parsed = resolveParsedCmd(item.command, item.commandActions);
			if (parsed.type === 'read' && parsed.name) names.add(parsed.name);
		}
	}
	return names.size;
}

function segmentExplorationItems(items: WorkingItem[], isTurnInProgress: boolean): SegmentedWorkingItem[] {
	const out: SegmentedWorkingItem[] = [];
	let current: WorkingItem[] | null = null;
	let pendingReading: WorkingItem | null = null;

	const flush = (status: 'exploring' | 'explored') => {
		if (current && current.length > 0) {
			const firstItem = current[0];
			const firstId = isReadingGroup(firstItem)
				? firstItem.id
				: `${(firstItem as ChatEntry).id}-explore`;
			out.push({
				kind: 'exploration',
				id: `explore-${firstId}`,
				status,
				items: current,
				uniqueFileCount: getUniqueReadingCount(current),
			});
		}
		current = null;
	};

	for (const item of items) {
		const buffered: WorkingItem[] = [];
		if (pendingReading) {
			buffered.push(pendingReading);
			pendingReading = null;
		}

		if (current) {
			if (isExplorationContinuation(item)) {
				current.push(item);
				continue;
			}
			if (isReadingGroup(item)) {
				pendingReading = item;
				flush('explored');
				continue;
			}
			flush('explored');
		}

		if (isExplorationStarter(item)) {
			current = [item];
			continue;
		}
		if (isReadingGroup(item)) {
			pendingReading = item;
			continue;
		}

		buffered.forEach((bufferedItem) => out.push({ kind: 'item', item: bufferedItem }));
		out.push({ kind: 'item', item });
	}

	if (current) {
		flush(isTurnInProgress ? 'exploring' : 'explored');
	}
	if (pendingReading) {
		out.push({ kind: 'item', item: pendingReading });
	}
	return out;
}

function countWorkingItems(items: SegmentedWorkingItem[]): number {
	return items.reduce((acc, item) => {
		if (item.kind === 'exploration') return acc + item.items.length;
		return acc + 1;
	}, 0);
}

function countRenderedWorkingItems(items: SegmentedWorkingItem[]): number {
	return items.reduce((acc, item) => {
		if (item.kind === 'exploration') return acc + 1 + item.items.length;
		return acc + 1;
	}, 0);
}

function formatExplorationHeader(
	status: 'exploring' | 'explored',
	uniqueFileCount: number
): { prefix: string; content: string } {
	const prefix = status === 'exploring' ? 'Exploring' : 'Explored';
	if (!uniqueFileCount || uniqueFileCount <= 0) return { prefix, content: '' };
	const unit = uniqueFileCount === 1 ? 'file' : 'files';
	return { prefix, content: `${uniqueFileCount} ${unit}` };
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
			const structuredOutput = parseCodeReviewStructuredOutputFromMessage(it.text);
			return {
				kind: 'assistant',
				id: it.id,
				role: 'message',
				text: it.text,
				completed: true,
				renderPlaceholderWhileStreaming: false,
				structuredOutput,
			};
		}
		case 'error': {
			const it = item as Extract<CodexThreadItem, { type: 'error' }>;
			return {
				kind: 'system',
				id: it.id,
				tone: 'error',
				text: it.message,
				willRetry: it.willRetry ?? null,
				additionalDetails: it.additionalDetails ?? null,
			};
		}
		case 'reasoning': {
			const it = item as Extract<CodexThreadItem, { type: 'reasoning' }>;
			const summary = coerceReasoningParts(it.summary);
			const content = coerceReasoningParts(it.content);
			return {
				kind: 'assistant',
				id: it.id,
				role: 'reasoning',
				text: buildReasoningText(summary, content),
				reasoningSummary: summary,
				reasoningContent: content,
			};
		}
		case 'commandexecution': {
			const it = item as Extract<CodexThreadItem, { type: 'commandExecution' }>;
			const rawActions =
				(it as unknown as { commandActions?: unknown; command_actions?: unknown })?.commandActions ??
				(it as unknown as { commandActions?: unknown; command_actions?: unknown })?.command_actions;
			const commandActions = normalizeCommandActions(rawActions);
			return {
				kind: 'command',
				id: it.id,
				command: it.command,
				status: it.status,
				cwd: it.cwd,
				output: it.aggregatedOutput ?? null,
				commandActions,
			};
		}
		case 'filechange': {
			const it = item as Extract<CodexThreadItem, { type: 'fileChange' }>;
			return {
				kind: 'fileChange',
				id: it.id,
				status: it.status,
				changes: it.changes.map((c) => ({ path: c.path, diff: c.diff, kind: c.kind })),
			};
		}
		case 'websearch': {
			const it = item as Extract<CodexThreadItem, { type: 'webSearch' }>;
			return { kind: 'webSearch', id: it.id, query: it.query };
		}
		case 'mcptoolcall': {
			const it = item as Extract<CodexThreadItem, { type: 'mcpToolCall' }>;
			const result = normalizeMcpResult(it.result ?? null);
			const error = normalizeMcpError(it.error ?? null);
			return {
				kind: 'mcp',
				id: it.id,
				server: it.server,
				tool: it.tool,
				arguments: it.arguments,
				result,
				error,
				durationMs: it.durationMs ?? null,
				status: it.status,
				message: error?.message,
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
	// Keep previously computed structured output unless the update explicitly sets it.
	if (next.kind === 'assistant') {
		const prev = copy[idx] as Extract<ChatEntry, { kind: 'assistant' }>;
		const incoming = next as Extract<ChatEntry, { kind: 'assistant' }>;
		const reasoningSummary =
			incoming.role === 'reasoning'
				? incoming.reasoningSummary ?? prev.reasoningSummary
				: prev.reasoningSummary;
		const reasoningContent =
			incoming.role === 'reasoning'
				? incoming.reasoningContent ?? prev.reasoningContent
				: prev.reasoningContent;
		const nextText =
			incoming.role === 'reasoning'
				? buildReasoningText(reasoningSummary ?? [], reasoningContent ?? [])
				: incoming.text ?? prev.text;
		copy[idx] = {
			...prev,
			...incoming,
			text: nextText,
			reasoningSummary,
			reasoningContent,
			structuredOutput:
				incoming.structuredOutput !== undefined ? incoming.structuredOutput : prev.structuredOutput,
		} as ChatEntry;
	} else {
		copy[idx] = { ...copy[idx], ...next } as ChatEntry;
	}
	return copy;
}

function appendDelta(entries: ChatEntry[], id: string, role: 'message' | 'reasoning', delta: string): ChatEntry[] {
	const idx = entries.findIndex((e) => e.kind === 'assistant' && e.id === id && e.role === role);
	if (idx === -1) {
		const renderPlaceholder = role === 'message' && shouldHideAssistantMessageContent(delta);
		return [
			...entries,
			{
				kind: 'assistant',
				id,
				role,
				text: delta,
				streaming: true,
				completed: false,
				renderPlaceholderWhileStreaming: renderPlaceholder,
				structuredOutput: null,
			},
		];
	}
	const copy = [...entries];
	const existing = copy[idx] as Extract<ChatEntry, { kind: 'assistant' }>;
	const nextText = `${existing.text}${delta}`;
	const renderPlaceholder =
		role === 'message' ? shouldHideAssistantMessageContent(nextText) : existing.renderPlaceholderWhileStreaming;
	copy[idx] = {
		...existing,
		text: nextText,
		streaming: true,
		completed: false,
		renderPlaceholderWhileStreaming: renderPlaceholder,
		structuredOutput: null,
	};
	return copy;
}

function ensureReasoningIndex(parts: string[], index: number): string[] {
	if (!Number.isFinite(index) || index < 0) return parts;
	const next = parts.slice();
	while (next.length <= index) next.push('');
	return next;
}

function applyReasoningDelta(
	entries: ChatEntry[],
	id: string,
	delta: string,
	index: number,
	target: 'summary' | 'content'
): ChatEntry[] {
	if (!Number.isFinite(index) || index < 0) return entries;
	const idx = entries.findIndex((e) => e.kind === 'assistant' && e.id === id && e.role === 'reasoning');
	const base =
		idx === -1
			? ({
					kind: 'assistant',
					id,
					role: 'reasoning',
					text: '',
					reasoningSummary: [],
					reasoningContent: [],
					streaming: true,
					completed: false,
			  } as Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }>)
			: (entries[idx] as Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }>);

	const summary = ensureReasoningIndex(coerceReasoningParts(base.reasoningSummary), target === 'summary' ? index : -1);
	const content = ensureReasoningIndex(coerceReasoningParts(base.reasoningContent), target === 'content' ? index : -1);

	if (target === 'summary') summary[index] = `${summary[index] ?? ''}${delta}`;
	if (target === 'content') content[index] = `${content[index] ?? ''}${delta}`;

	const nextEntry: Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }> = {
		...base,
		reasoningSummary: summary,
		reasoningContent: content,
		text: buildReasoningText(summary, content),
		streaming: true,
		completed: false,
	};

	if (idx === -1) return [...entries, nextEntry];
	const copy = [...entries];
	copy[idx] = { ...copy[idx], ...nextEntry } as ChatEntry;
	return copy;
}

function applyReasoningPartAdded(
	entries: ChatEntry[],
	id: string,
	index: number,
	target: 'summary' | 'content'
): ChatEntry[] {
	if (!Number.isFinite(index) || index < 0) return entries;
	const idx = entries.findIndex((e) => e.kind === 'assistant' && e.id === id && e.role === 'reasoning');
	const base =
		idx === -1
			? ({
					kind: 'assistant',
					id,
					role: 'reasoning',
					text: '',
					reasoningSummary: [],
					reasoningContent: [],
			  } as Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }>)
			: (entries[idx] as Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }>);

	const summary = coerceReasoningParts(base.reasoningSummary);
	const content = coerceReasoningParts(base.reasoningContent);
	const nextSummary = target === 'summary' ? ensureReasoningIndex(summary, index) : summary;
	const nextContent = target === 'content' ? ensureReasoningIndex(content, index) : content;

	const nextEntry: Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }> = {
		...base,
		reasoningSummary: nextSummary,
		reasoningContent: nextContent,
		text: buildReasoningText(nextSummary, nextContent),
	};

	if (idx === -1) return [...entries, nextEntry];
	const copy = [...entries];
	copy[idx] = { ...copy[idx], ...nextEntry } as ChatEntry;
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

function SessionRunningIndicator({ className }: { className?: string }) {
	return (
		<svg
			className={['h-3 w-3 animate-spin', className].filter(Boolean).join(' ')}
			viewBox="0 0 32 32"
			aria-label="Running"
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
				className="text-status-info/70"
			/>
		</svg>
	);
}

export function CodexChat() {
	const [settings, setSettings] = useState<CodexChatSettings>(() => loadCodexChatSettings());
	const [sessions, setSessions] = useState<CodexThreadSummary[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(true);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [isSessionsOpen, setIsSessionsOpen] = useState(false);
	const [runningThreadIds, setRunningThreadIds] = useState<Record<string, boolean>>({});

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
	const [collapsedWorkingByTurnId, setCollapsedWorkingByTurnId] = useState<Record<string, boolean>>({});
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
			setCollapsedWorkingByTurnId({});
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
				const nextWorkingCollapsed: Record<string, boolean> = {};
				const typeCounts: Record<string, number> = {};

				for (const turn of thread.turns ?? []) {
					const turnId = turn.id;
					if (!turnId) continue;
					nextOrder.push(turnId);
					nextWorkingCollapsed[turnId] = true;

					const turnEntries: ChatEntry[] = [];
					const items = turn.items ?? [];
					const isTurnStreaming = turn.status === 'inProgress';
					const lastIdx = items.length > 0 ? items.length - 1 : -1;
					for (const [idx, item] of items.entries()) {
						const rawType = safeString((item as unknown as { type?: unknown })?.type);
						if (rawType) typeCounts[rawType] = (typeCounts[rawType] ?? 0) + 1;

						const baseEntry = entryFromThreadItem(item);
						let entry = baseEntry;

						// Plugin parity: the last agentMessage in an in-progress turn is considered streaming.
						if (baseEntry?.kind === 'assistant' && baseEntry.role === 'message') {
							const streaming = isTurnStreaming && idx === lastIdx;
							const completed = !streaming;
							const renderPlaceholder = streaming && shouldHideAssistantMessageContent(baseEntry.text);
							entry = {
								...baseEntry,
								streaming,
								completed,
								renderPlaceholderWhileStreaming: renderPlaceholder,
								structuredOutput: completed ? baseEntry.structuredOutput ?? null : null,
							};
						}
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
					nextWorkingCollapsed[turnId] = true;
					nextTurns[turnId] = { id: turnId, status: 'unknown', entries: [] };
				}

				if (import.meta.env.DEV) {
					// eslint-disable-next-line no-console
					console.info('[CodexChat] Resume thread item types:', typeCounts);
				}

				setTurnOrder(nextOrder);
				setTurnsById(nextTurns);
				setCollapsedWorkingByTurnId(nextWorkingCollapsed);
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
		setCollapsedWorkingByTurnId({});
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

	const toggleTurnWorking = useCallback((turnId: string) => {
		skipAutoScrollRef.current = true;
		const turn = turnsById[turnId];
		const collapsedExplicit = collapsedWorkingByTurnId[turnId];
		const currentOpen = collapsedExplicit === undefined ? turn?.status === 'inProgress' : !collapsedExplicit;
		const nextOpen = !currentOpen;
		const nextCollapsedExplicit = !nextOpen;

	if (turn && turn.status !== 'inProgress' && nextOpen) {
		const visible = settings.showReasoning
			? turn.entries
			: turn.entries.filter((e) => e.kind !== 'assistant' || e.role !== 'reasoning');
		const assistantMessages = visible.filter(
			(e): e is Extract<ChatEntry, { kind: 'assistant'; role: 'message' }> =>
				e.kind === 'assistant' && e.role === 'message'
		);
		const lastAssistantMessageId =
			assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1]?.id : null;
		const workingEntries = visible.filter((e) => {
			if (isActivityEntry(e)) return true;
			if (e.kind === 'system') return true;
			if (e.kind === 'assistant' && e.role === 'reasoning') return true;
			if (e.kind === 'assistant' && e.role === 'message') return e.id !== lastAssistantMessageId;
			return false;
		});
		const explorationGroupIds = segmentExplorationItems(
			mergeReadingEntries(expandReasoningEntries(workingEntries)),
			false
		).flatMap((item) => (item.kind === 'exploration' ? [item.id] : []));

		// 每次展开 "Finished working" 时，内部所有可折叠 block 强制折叠。
		// 这样 AI 过程性输出再多，也不会默认铺开占高度。
		setCollapsedByEntryId((prev) => {
			const next = { ...prev };
			for (const entry of turn.entries) {
				if (isActivityEntry(entry)) next[entry.id] = true;
				if (entry.kind === 'assistant' && entry.role === 'reasoning') next[entry.id] = true;
			}
			for (const groupId of collectReadingGroupIds(turn.entries)) {
				next[groupId] = true;
			}
			for (const segmentId of collectReasoningSegmentIds(turn.entries)) {
				next[segmentId] = true;
			}
			for (const explorationId of explorationGroupIds) {
				next[explorationId] = true;
			}
			return next;
		});
	}

		if (import.meta.env.DEV && turn && nextOpen) {
			const counts = countEntryKinds(turn.entries);
			// eslint-disable-next-line no-console
			console.info('[CodexChat] Expand turn:', {
				turnId,
				entryKinds: counts,
			});
		}

		setCollapsedWorkingByTurnId((prev) => ({ ...prev, [turnId]: nextCollapsedExplicit }));
	}, [collapsedWorkingByTurnId, settings.showReasoning, turnsById]);

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
		void seedRunningThreads();
		loadModelsAndChatDefaults();
		void loadWorkspaceRoot();
		void loadRecentWorkspaces();
		void loadSkills();
		void loadPrompts();
	}, [
		listSessions,
		seedRunningThreads,
		loadModelsAndChatDefaults,
		loadWorkspaceRoot,
		loadRecentWorkspaces,
		loadSkills,
		loadPrompts,
	]);

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
				if (method === 'turn/started' && threadId) {
					setThreadRunning(threadId, true);
				}
				if (method === 'turn/completed' && threadId) {
					setThreadRunning(threadId, false);
				}
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
					let entry = entryFromThreadItem(item);
					if (!entry) return;
					if (entry.kind === 'assistant' && entry.role === 'message') {
						const completed = method === 'item/completed';
						entry = {
							...entry,
							streaming: !completed,
							completed,
							renderPlaceholderWhileStreaming: !completed && shouldHideAssistantMessageContent(entry.text),
							structuredOutput: completed ? parseCodeReviewStructuredOutputFromMessage(entry.text) : null,
						};
					}
					if (entry.kind === 'assistant' && entry.role === 'reasoning') {
						const completed = method === 'item/completed';
						entry = {
							...entry,
							streaming: !completed,
							completed,
						};
					}
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

				if (method === 'item/reasoning/summaryTextDelta') {
					const itemId = safeString(params?.itemId);
					const delta = safeString(params?.delta);
					const index = Number(params?.summaryIndex ?? params?.summary_index ?? params?.index);
					if (!itemId || !delta) return;
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						return {
							...prev,
							[turnId]: {
								...existing,
								entries: applyReasoningDelta(existing.entries, itemId, delta, index, 'summary'),
							},
						};
					});
					return;
				}

				if (method === 'item/reasoning/summaryPartAdded') {
					const itemId = safeString(params?.itemId);
					const index = Number(params?.summaryIndex ?? params?.summary_index ?? params?.index);
					if (!itemId) return;
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						return {
							...prev,
							[turnId]: {
								...existing,
								entries: applyReasoningPartAdded(existing.entries, itemId, index, 'summary'),
							},
						};
					});
					return;
				}

				if (method === 'item/reasoning/textDelta') {
					const itemId = safeString(params?.itemId);
					const delta = safeString(params?.delta);
					const index = Number(params?.contentIndex ?? params?.content_index ?? params?.index);
					if (!itemId || !delta) return;
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						return {
							...prev,
							[turnId]: {
								...existing,
								entries: applyReasoningDelta(existing.entries, itemId, delta, index, 'content'),
							},
						};
					});
					return;
				}

				if (method === 'item/reasoning/contentPartAdded') {
					const itemId = safeString(params?.itemId);
					const index = Number(params?.contentIndex ?? params?.content_index ?? params?.index);
					if (!itemId) return;
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? PENDING_TURN_ID;
					setTurnsById((prev) => {
						const existing = prev[turnId];
						if (!existing) return prev;
						return {
							...prev,
							[turnId]: {
								...existing,
								entries: applyReasoningPartAdded(existing.entries, itemId, index, 'content'),
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
					const willRetryRaw = params?.error?.willRetry ?? params?.error?.will_retry;
					const additionalDetailsRaw = params?.error?.additionalDetails ?? params?.error?.additional_details;
					const willRetry = typeof willRetryRaw === 'boolean' ? willRetryRaw : null;
					const additionalDetails = typeof additionalDetailsRaw === 'string' ? additionalDetailsRaw : null;
					const turnId = activeTurnId ?? PENDING_TURN_ID;
					const entry: ChatEntry = {
						kind: 'system',
						id: `system-err-${crypto.randomUUID()}`,
						tone: 'error',
						text: errMsg,
						willRetry,
						additionalDetails,
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
	}, [activeTurnId, selectedThreadId, setThreadRunning, settings.defaultCollapseDetails]);

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

			const userEntries = visible.filter((e) => e.kind === 'user') as Extract<ChatEntry, { kind: 'user' }>[];
			const assistantMessages = visible.filter(
				(e): e is Extract<ChatEntry, { kind: 'assistant' }> => e.kind === 'assistant' && e.role === 'message'
			);
			const lastAssistantMessageId = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1]?.id : null;
			const assistantMessageEntries = lastAssistantMessageId
				? assistantMessages.filter((e) => e.id === lastAssistantMessageId)
				: [];
			const workingEntries = visible.filter((e) => {
				if (isActivityEntry(e)) return true;
				if (e.kind === 'system') return true;
				if (e.kind === 'assistant' && e.role === 'reasoning') return true;
				// Plugin parity: earlier assistant-messages stay in Working; only the last one is the final reply.
				if (e.kind === 'assistant' && e.role === 'message') return e.id !== lastAssistantMessageId;
				return false;
			});
			const expandedWorkingEntries = expandReasoningEntries(workingEntries);
			const mergedWorkingItems = mergeReadingEntries(expandedWorkingEntries);
			const workingItems = segmentExplorationItems(mergedWorkingItems, turn.status === 'inProgress');
			const workingItemCount = countWorkingItems(workingItems);
			const workingRenderCount = countRenderedWorkingItems(workingItems);

			return {
				id: turn.id,
				status: turn.status,
				userEntries,
				assistantMessageEntries,
				workingItems,
				workingItemCount,
				workingRenderCount,
			};
		});
	}, [settings.showReasoning, turnBlocks]);

	const renderCount = useMemo(() => {
		return renderTurns.reduce((acc, t) => {
			const collapsedExplicit = collapsedWorkingByTurnId[t.id];
			const workingOpen = collapsedExplicit === undefined ? t.status === 'inProgress' : !collapsedExplicit;
			const workingHeaderCount = t.workingItemCount > 0 ? 1 : 0;
			const visibleWorkingCount = workingOpen ? t.workingRenderCount : 0;
			return acc + t.userEntries.length + workingHeaderCount + visibleWorkingCount + t.assistantMessageEntries.length;
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

	const sidebarIconButtonPx = Math.round(SIDEBAR_ICON_BUTTON_PX);
	const sidebarIconSizePx = Math.max(10, Math.round(sidebarIconButtonPx * 0.62));

		const renderWorkingItem = (item: WorkingItem): JSX.Element | null => {
			if (isReadingGroup(item)) {
				const isFinished = item.entries.every((entry) => entry.status !== 'inProgress');
				const collapsed = collapsedByEntryId[item.id] ?? settings.defaultCollapseDetails;
				const parsedEntries = item.entries.map((entry) => ({
					entry,
					parsed: resolveParsedCmd(entry.command, entry.commandActions),
					output: normalizeCommandOutput(entry.output ?? null),
					displayOutput: prefixCommandLine(entry.command, entry.output ?? null),
				}));
			const uniqueByName: typeof parsedEntries = [];
			const seen = new Set<string>();
			for (let i = parsedEntries.length - 1; i >= 0; i -= 1) {
				const name = parsedEntries[i]?.parsed.name;
				if (!name) continue;
				if (seen.has(name)) continue;
				seen.add(name);
				uniqueByName.push(parsedEntries[i]);
			}
			uniqueByName.reverse();

			const lastUnique = uniqueByName[uniqueByName.length - 1];
			const lastName = lastUnique?.parsed.name || 'file';
			const count = Math.max(0, uniqueByName.length - 1);

			const prefix = isFinished ? 'Read' : 'Reading';
			const title =
				uniqueByName.length === 0
					? 'files'
					: uniqueByName.length === 1
						? lastName
						: `${lastName} +${count}`;

				const copyContent = parsedEntries
					.map(({ output, displayOutput }) => (output ? displayOutput : ''))
					.filter(Boolean)
					.join('\n\n');

				return (
					<ActivityBlock
						key={item.id}
					titlePrefix={prefix}
					titleContent={title}
					status={!isFinished ? 'in progress' : undefined}
					copyContent={copyContent.replace(/\x1b\[[0-9;]*m/g, '')}
					icon={<BookOpen className="h-3.5 w-3.5" />}
					contentClassName="font-sans"
					collapsible
					collapsed={collapsed}
					onToggleCollapse={() => toggleEntryCollapse(item.id)}
					>
						{parsedEntries.some(({ output }) => output) ? (
							<div className="space-y-2">
								{parsedEntries
									.filter(({ output }) => output)
									.map(({ entry, parsed, displayOutput }) => (
										<div key={entry.id} className="space-y-1">
											<div className="text-[9px] font-medium text-text-muted">{parsed.name || 'file'}</div>
											<div className="whitespace-pre-wrap break-words font-mono text-[10px] text-text-muted">
												{renderAnsiText(displayOutput)}
											</div>
										</div>
									))}
						</div>
					) : null}
				</ActivityBlock>
			);
		}

		const e = item as ChatEntry;
		if (e.kind === 'assistant' && e.role === 'message') {
			const showPlaceholder = !!e.renderPlaceholderWhileStreaming && !e.completed;
			const structured = e.structuredOutput && e.structuredOutput.type === 'code-review' ? e.structuredOutput : null;
			return (
				<div key={e.id} className="px-2 py-1">
					{showPlaceholder ? (
						<div className="text-[11px] text-text-menuDesc">Generating…</div>
					) : structured ? (
						<CodeReviewAssistantMessage
							output={structured}
							completed={!!e.completed}
						/>
					) : (
						<ChatMarkdown
							text={e.text}
							className="text-[11px] text-text-menuDesc"
							dense
						/>
					)}
				</div>
			);
		}

			if (e.kind === 'command') {
				const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
				const displayContent = prefixCommandLine(e.command, e.output ?? null);
				const copyText = displayContent.replace(/\x1b\[[0-9;]*m/g, '');
				const parsed = resolveParsedCmd(e.command, e.commandActions);
				const isFinished = e.status !== 'inProgress';
				const summary = getCmdSummary(parsed, isFinished, e.command);
				const useMono =
					parsed.type === 'unknown' || parsed.type === 'format' || parsed.type === 'test' || parsed.type === 'lint';
				const open = !collapsed;
				const shellHeader = (
					<div className="group flex min-w-0 items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2">
							<span className="text-text-menuLabel">Shell</span>
							{e.cwd ? (
								<span className="truncate font-mono text-[10px] text-text-menuDesc">{e.cwd}</span>
							) : null}
						</div>
						<div className="flex items-center gap-1">
							{copyText ? (
								<button
									type="button"
									className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
									title="Copy shell"
									onClick={(ev) => {
										ev.stopPropagation();
										void navigator.clipboard.writeText(copyText);
									}}
								>
									<Copy className="h-3 w-3" />
								</button>
							) : null}
							<button
								type="button"
								className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
								title={open ? 'Collapse' : 'Expand'}
								onClick={(ev) => {
									ev.stopPropagation();
									toggleEntryCollapse(e.id);
								}}
							>
								<ChevronRight
									className={[
										'h-3 w-3 transition-transform duration-200',
										open ? 'rotate-90' : '',
									].join(' ')}
								/>
							</button>
						</div>
					</div>
				);
				return (
					<ActivityBlock
						key={e.id}
						titlePrefix={summary.prefix}
						titleContent={summary.content}
						titleMono={useMono}
						status={e.status !== 'completed' ? e.status : undefined}
						copyContent={copyText}
						icon={<Terminal className="h-3.5 w-3.5" />}
						contentVariant="ansi"
						collapsible
						collapsed={collapsed}
						onToggleCollapse={() => toggleEntryCollapse(e.id)}
						detailHeader={shellHeader}
						approval={e.approval}
						onApprove={approve}
					>
						{displayContent}
					</ActivityBlock>
			);
		}

			if (e.kind === 'fileChange') {
				const summary = buildFileChangeSummary(e);
				const isPending = e.status !== 'completed';
				const defaultCollapsed = settings.defaultCollapseDetails;
				const approval = e.approval;
				return (
					<div key={e.id} className="space-y-2">
						{summary.changes.length > 0 ? (
							summary.changes.map((change) => (
								<FileChangeEntryCard
									key={`${change.path}-${change.kind.type}`}
									change={change}
									isPending={isPending}
									defaultCollapsed={defaultCollapsed}
								/>
							))
						) : (
							<div className="text-[10px] italic text-text-muted">No diff content</div>
						)}
						{approval ? (
							<div className="mt-1 flex flex-wrap items-center justify-between gap-2 pl-2 pr-1">
								<div className="min-w-0 text-xs text-text-muted">
									Approval required
									{approval.reason ? `: ${approval.reason}` : ''}.
								</div>
								<div className="flex shrink-0 gap-2">
									<button
										type="button"
										className="rounded-md bg-status-success/20 px-2.5 py-1 text-[11px] font-semibold text-status-success hover:bg-status-success/30 transition-colors"
										onClick={() => approve(approval.requestId, 'accept')}
									>
										Approve
									</button>
									<button
										type="button"
										className="rounded-md bg-status-error/15 px-2.5 py-1 text-[11px] font-semibold text-status-error hover:bg-status-error/25 transition-colors"
										onClick={() => approve(approval.requestId, 'decline')}
									>
										Decline
									</button>
								</div>
							</div>
						) : null}
					</div>
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
					icon={<Search className="h-3.5 w-3.5" />}
					contentVariant="plain"
					collapsible
					collapsed={collapsed}
					onToggleCollapse={() => toggleEntryCollapse(e.id)}
				>
					{e.query}
				</ActivityBlock>
			);
		}

		if (e.kind === 'mcp') {
			const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
			const contentBlocks = Array.isArray(e.result?.content) ? e.result?.content ?? [] : [];
			const structuredContent = e.result?.structuredContent ?? null;
			const errorMessage = e.error?.message;
			const progressMessage = !e.result && !e.error ? e.message : undefined;
			const argsPreview = formatMcpArgsPreview(e.arguments);
			const toolLabel = `${e.server}.${e.tool}(${argsPreview})`;
			const hasContent = contentBlocks.length > 0;
			const hasStructured = structuredContent !== null && structuredContent !== undefined;
			const copyContent = [
				hasContent ? mcpContentToText(contentBlocks) : '',
				hasStructured ? stringifyJsonSafe(structuredContent) : '',
				errorMessage ?? '',
				progressMessage ?? '',
			]
				.filter(Boolean)
				.join('\n\n');
			return (
				<ActivityBlock
					key={e.id}
					titlePrefix="MCP:"
					titleContent={toolLabel}
					titleMono
					status={e.status !== 'completed' ? e.status : undefined}
					copyContent={copyContent || toolLabel}
					icon={<Wrench className="h-3.5 w-3.5" />}
					contentClassName="font-sans"
					collapsible
					collapsed={collapsed}
					onToggleCollapse={() => toggleEntryCollapse(e.id)}
				>
					<div className="space-y-2">
						{progressMessage ? <div className="text-[10px] text-text-muted">{progressMessage}</div> : null}
						{hasContent ? renderMcpContentBlocks(contentBlocks) : null}
						{errorMessage ? (
							<div className="whitespace-pre-wrap text-[10px] text-status-error">{errorMessage}</div>
						) : null}
						{hasStructured ? (
							<pre className="whitespace-pre-wrap break-words rounded-md bg-white/5 px-2 py-1 text-[10px] text-text-muted">
								{stringifyJsonSafe(structuredContent)}
							</pre>
						) : null}
						{!progressMessage && !hasContent && !errorMessage && !hasStructured ? (
							<div className="text-[10px] text-text-muted">Tool returned no content</div>
						) : null}
					</div>
				</ActivityBlock>
			);
		}

		if (e.kind === 'assistant' && e.role === 'reasoning') {
			const collapsed = e.streaming ? false : (collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails);

			const { heading, body } = extractHeadingFromMarkdown(e.text);
			const hasHeading = !!heading;
			const titlePrefix = hasHeading ? '' : e.streaming ? 'Thinking' : 'Thought';
			const titleContent = heading || '';
			const displayBody = hasHeading ? body : e.text;
			const trimmedBody = displayBody.trim();
			const hasBody = trimmedBody.length > 0;

			return (
				<ActivityBlock
					key={e.id}
					titlePrefix={titlePrefix}
					titleContent={titleContent}
					status={e.streaming ? 'Streaming…' : undefined}
					copyContent={e.text}
					icon={<Brain className="h-3.5 w-3.5" />}
					contentVariant="markdown"
					collapsible={hasBody}
					collapsed={hasBody ? collapsed : true}
					onToggleCollapse={hasBody ? () => toggleEntryCollapse(e.id) : undefined}
				>
					{hasBody ? (
						<ChatMarkdown
							text={displayBody}
							className="text-[11px] text-text-muted"
							dense
						/>
					) : null}
				</ActivityBlock>
			);
		}

		if (e.kind === 'system') {
			const tone = e.tone ?? 'info';
			const isError = tone === 'error';
			const hasDetails = !!e.additionalDetails;
			if (isError && hasDetails) {
				const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
				const summary = e.willRetry ? 'Error (retrying)' : 'Error';
				const content = `${e.text}\n\n${e.additionalDetails ?? ''}`.trim();
				return (
					<ActivityBlock
						key={e.id}
						titlePrefix={summary}
						titleContent={e.text}
						copyContent={content}
						collapsible
						collapsed={collapsed}
						onToggleCollapse={() => toggleEntryCollapse(e.id)}
					>
						{content}
					</ActivityBlock>
				);
			}
			const color =
				tone === 'error'
					? 'bg-status-error/10 text-status-error'
					: tone === 'warning'
						? 'bg-status-warning/10 text-status-warning'
						: 'bg-bg-panel/10 text-text-muted';

			return (
				<div
					key={e.id}
					className={`am-row am-row-hover text-xs ${color}`}
				>
					<div className="whitespace-pre-wrap break-words">{e.text}</div>
				</div>
			);
		}

		return null;
	};

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
							const collapsedExplicit = collapsedWorkingByTurnId[turn.id];
							const workingOpen = collapsedExplicit === undefined ? turn.status === 'inProgress' : !collapsedExplicit;
							const hasWorking = turn.workingItemCount > 0;

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

									{hasWorking ? (
										<button
											type="button"
											className="inline-flex items-center gap-2 rounded-full border border-border-menuDivider bg-bg-panel/20 px-3 py-1 text-left text-[12px] text-text-muted transition-colors hover:bg-bg-panelHover/30 hover:text-text-main"
											onClick={() => toggleTurnWorking(turn.id)}
										>
											<div className="flex items-center gap-2 text-[11px] text-text-muted">
												<span className="truncate font-medium">
													{turnStatusLabel(turn.status)}
													{turn.id === PENDING_TURN_ID ? ' (pending)' : ''}
												</span>
												<span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-text-menuDesc">
													{turn.workingItemCount}
												</span>
											</div>
											<ChevronRight
												className={[
													'h-3.5 w-3.5 text-text-menuDesc transition-transform duration-200',
													workingOpen ? 'rotate-90' : '',
												].join(' ')}
											/>
										</button>
									) : null}

									{hasWorking ? (
										<Collapse open={workingOpen} innerClassName="pt-0.5">
											<div className="space-y-1">
												{turn.workingItems.map((item) => {
													if (item.kind === 'exploration') {
														const { prefix, content } = formatExplorationHeader(item.status, item.uniqueFileCount);
														const collapsed =
															item.status === 'exploring'
																? false
																: (collapsedByEntryId[item.id] ?? settings.defaultCollapseDetails);
														const hasItems = item.items.length > 0;
														const copyContent = content ? `${prefix} ${content}` : prefix;
														return (
															<ActivityBlock
																key={item.id}
																titlePrefix={prefix}
																titleContent={content}
																copyContent={copyContent}
																icon={<BookOpen className="h-3.5 w-3.5" />}
																contentClassName="space-y-1"
																collapsible={hasItems}
																collapsed={hasItems ? collapsed : true}
																onToggleCollapse={hasItems ? () => toggleEntryCollapse(item.id) : undefined}
															>
																{item.items.map((child) => renderWorkingItem(child))}
															</ActivityBlock>
														);
													}
													return renderWorkingItem(item.item);
												})}
											</div>
										</Collapse>
									) : null}

									<div className="space-y-2">
										{turn.assistantMessageEntries.map((e) => (
											<div
												key={e.id}
												className="px-1 py-1 text-[12px] leading-[1.25] text-text-muted"
											>
												{e.renderPlaceholderWhileStreaming && !e.completed ? (
													<div className="text-[12px] text-text-menuDesc">Generating…</div>
												) : e.structuredOutput && e.structuredOutput.type === 'code-review' ? (
													<CodeReviewAssistantMessage output={e.structuredOutput} completed={!!e.completed} />
												) : (
													<ChatMarkdown
														text={e.text}
														className="text-text-muted !leading-[1.25]"
														dense
													/>
												)}
											</div>
										))}
									</div>
								</div>
							);
						})}
					</div>

					<div className="relative -mx-6 mt-3 rounded-xl border border-token-border/80 bg-token-inputBackground/70 px-4 py-3 backdrop-blur">
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
															className={`${MENU_STYLES.popoverTitle} ${filteredSlashCommands.length > 0 ? 'mt-2 border-t border-border-menuDivider pt-2' : ''
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
															className={`${MENU_STYLES.popoverTitle} ${filteredSlashCommands.length > 0 || filteredPromptsForSlashMenu.length > 0
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
									className="am-icon-button h-7 w-7"
									title="Add context"
									onClick={() => setIsAddContextOpen((v) => !v)}
								>
									<Plus className="h-3.5 w-3.5" />
								</button>

								{/* / Slash Commands Button */}
								<button
									type="button"
									className="am-icon-button h-7 w-7"
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
											? `cwd: ${autoContext.cwd}\nRecent: ${autoContext.recentFiles.length} files\nGit: ${autoContext.gitStatus?.branch ?? 'N/A'
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
												className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${approvalPolicy === 'untrusted' ? '' : 'invisible'
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
												className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${approvalPolicy === 'never' ? '' : 'invisible'
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
												className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${approvalPolicy === 'on-request' || approvalPolicy === 'on-failure' ? '' : 'invisible'
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
													const isRunning = Boolean(runningThreadIds[s.id]);
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
														<div className="truncate text-sm font-semibold">{s.preview || '—'}</div>

															<div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-dim">
																<span className="truncate">{s.modelProvider}</span>
																<span className="flex shrink-0 items-center gap-1.5">
																	{isRunning ? <SessionRunningIndicator /> : null}
																	<span>{formatSessionUpdatedAtMs(s)}</span>
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
