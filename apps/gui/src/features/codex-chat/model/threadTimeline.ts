import type { CodexThread, CodexThreadItem, CodexUserInput } from '@/types/codex';
import { parseCodeReviewStructuredOutputFromMessage, shouldHideAssistantMessageContent } from '../codex/assistantMessage';
import type { AttachmentItem, ChatEntry, SegmentedWorkingItem, TurnBlockData, TurnBlockStatus, WorkingItem } from '../codex/types';
import { normalizeCommandActions, normalizeMcpError, normalizeMcpResult, resolveParsedCmd, safeString } from '../codex/utils';
import { isReadingGroup, isReasoningGroup } from '../lib/turn/exploration';

export const PENDING_TURN_ID = '__pending__';

export function isCollapsibleEntry(entry: ChatEntry): entry is Extract<ChatEntry, { kind: 'command' | 'fileChange' | 'webSearch' | 'mcp' | 'collab' }> {
	return entry.kind === 'command' || entry.kind === 'fileChange' || entry.kind === 'webSearch' || entry.kind === 'mcp' || entry.kind === 'collab';
}

export function isActivityEntry(entry: ChatEntry): entry is Extract<ChatEntry, { kind: 'command' | 'fileChange' | 'mcp' | 'webSearch' | 'collab' }> {
	return entry.kind === 'command' || entry.kind === 'fileChange' || entry.kind === 'mcp' || entry.kind === 'webSearch' || entry.kind === 'collab';
}

export function parseTurnStatus(value: unknown): TurnBlockStatus {
	if (typeof value !== 'string') return 'unknown';
	if (value === 'inProgress') return 'inProgress';
	if (value === 'completed') return 'completed';
	if (value === 'failed') return 'failed';
	if (value === 'interrupted') return 'interrupted';
	return 'unknown';
}

function isReasoningEntry(item: WorkingItem): item is Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }> {
	return !isReadingGroup(item) && !isReasoningGroup(item) && item.kind === 'assistant' && item.role === 'reasoning';
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

export function expandReasoningEntries(entries: ChatEntry[]): ChatEntry[] {
	const expanded: ChatEntry[] = [];
	for (const entry of entries) {
		if (entry.kind === 'assistant' && entry.role === 'reasoning') {
			expanded.push(...buildReasoningSegments(entry));
			continue;
		}
		expanded.push(entry);
	}
	return expanded;
}

export function mergeReadingEntries(entries: ChatEntry[]): WorkingItem[] {
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

export function mergeReasoningEntries(items: WorkingItem[]): WorkingItem[] {
	return items;
}

function isExplorationStarter(item: WorkingItem): boolean {
	if (isReadingGroup(item)) return true;
	if (isReasoningGroup(item) || isReasoningEntry(item)) return true;
	if (item.kind === 'command') {
		const parsed = resolveParsedCmd(item.command, item.commandActions);
		return parsed.type === 'read' || parsed.type === 'search' || parsed.type === 'list_files';
	}
	return false;
}

function isExplorationContinuation(item: WorkingItem): boolean {
	return isExplorationStarter(item);
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

export function segmentExplorationItems(items: WorkingItem[], isTurnInProgress: boolean): SegmentedWorkingItem[] {
	const out: SegmentedWorkingItem[] = [];
	let current: WorkingItem[] | null = null;
	let pendingReading: WorkingItem | null = null;

	const flush = (status: 'exploring' | 'explored') => {
		if (current && current.length > 0) {
			const firstItem = current[0];
			const firstId = isReadingGroup(firstItem) ? firstItem.id : `${(firstItem as ChatEntry).id}-explore`;
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

export function countWorkingItems(items: SegmentedWorkingItem[]): number {
	return items.reduce((acc, item) => {
		if (item.kind === 'exploration') {
			return (
				acc +
				item.items.reduce((inner, innerItem) => {
					if (isReasoningGroup(innerItem)) return inner + innerItem.entries.length;
					return inner + 1;
				}, 0)
			);
		}
		if (item.kind === 'item' && isReasoningGroup(item.item)) return acc + item.item.entries.length;
		return acc + 1;
	}, 0);
}

export function countRenderedWorkingItems(items: SegmentedWorkingItem[]): number {
	// Each segmented item renders as a top-level block in the turn.
	return items.length;
}

function isCodexTextInput(value: CodexUserInput): value is Extract<CodexUserInput, { type: 'text' }> {
	return value.type === 'text' && typeof (value as { text?: unknown }).text === 'string';
}

function extractUserText(item: Extract<CodexThreadItem, { type: 'userMessage' }>): string {
	const parts = item.content.filter(isCodexTextInput).map((c) => c.text);
	return parts.join('\n').trim();
}

export function isImageDataUrl(value: string): boolean {
	return value.startsWith('data:image');
}

export function basenameFromPath(value: string): string {
	const normalized = value.replace(/\\/g, '/');
	const parts = normalized.split('/');
	return parts[parts.length - 1] || value;
}

export function guessImageNameFromDataUrl(url: string): string {
	const match = url.match(/^data:(image\/[^;]+);base64,/);
	if (!match) return 'image';
	const mime = match[1] ?? '';
	let ext = mime.split('/')[1] ?? '';
	ext = ext.toLowerCase().replace('jpeg', 'jpg');
	ext = ext.split('+')[0] ?? ext;
	return ext ? `image.${ext}` : 'image';
}

function imageUrlDedupKey(url: string): string {
	// Avoid using the whole base64 string as a Set key (can be very large).
	const head = url.slice(0, 24);
	const tail = url.slice(-24);
	return `image:${url.length}:${head}:${tail}`;
}

export function attachmentDedupKey(att: AttachmentItem): string {
	switch (att.type) {
		case 'file':
			return `file:${att.path}`;
		case 'skill':
			return `skill:${att.name}`;
		case 'prompt':
			return `prompt:${att.name}`;
		case 'image':
			return imageUrlDedupKey(att.url);
		case 'localImage':
			return `localImage:${att.path}`;
		default:
			return `${(att as any)?.type ?? 'unknown'}`;
	}
}

function extractUserAttachments(item: Extract<CodexThreadItem, { type: 'userMessage' }>): AttachmentItem[] {
	const out: AttachmentItem[] = [];
	const seen = new Set<string>();
	for (const content of item.content ?? []) {
		if (content.type === 'skill' && typeof content.name === 'string') {
			const att: AttachmentItem = { type: 'skill', name: content.name };
			const key = attachmentDedupKey(att);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(att);
			continue;
		}

		if (content.type === 'image' && typeof (content as { url?: unknown }).url === 'string') {
			const url = (content as { url: string }).url;
			const name = guessImageNameFromDataUrl(url);
			const att: AttachmentItem = { type: 'image', url, name };
			const key = attachmentDedupKey(att);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(att);
			continue;
		}

		if (content.type === 'localImage' && typeof (content as { path?: unknown }).path === 'string') {
			const path = (content as { path: string }).path;
			const name = basenameFromPath(path);
			const att: AttachmentItem = { type: 'localImage', path, name };
			const key = attachmentDedupKey(att);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(att);
		}
	}
	return out;
}

export function entryFromThreadItem(item: CodexThreadItem): ChatEntry | null {
	const rawType = safeString((item as unknown as { type?: unknown })?.type);
	// Backend payloads may use different naming conventions; normalize for compatibility.
	const typeKey = rawType.replace(/[-_]/g, '').toLowerCase();

	switch (typeKey) {
		case 'usermessage': {
			const it = item as Extract<CodexThreadItem, { type: 'userMessage' }>;
			const attachments = extractUserAttachments(it);
			return {
				kind: 'user',
				id: it.id,
				text: extractUserText(it),
				attachments: attachments.length > 0 ? attachments : undefined,
			};
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
				changes: it.changes.map((c) => ({
					path: c.path,
					diff: c.diff,
					kind: c.kind,
					lineNumbersAvailable:
						(c as { lineNumbersAvailable?: boolean; line_numbers_available?: boolean }).lineNumbersAvailable ??
						(c as { lineNumbersAvailable?: boolean; line_numbers_available?: boolean }).line_numbers_available,
				})),
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
		case 'collabagenttoolcall': {
			const it = item as Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>;
			return {
				kind: 'collab',
				id: it.id,
				tool: it.tool,
				status: it.status,
				senderThreadId: it.senderThreadId,
				receiverThreadIds: Array.isArray(it.receiverThreadIds) ? it.receiverThreadIds : [],
				prompt: it.prompt ?? null,
				agentsStates: it.agentsStates ?? {},
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

export function mergeEntry(entries: ChatEntry[], next: ChatEntry): ChatEntry[] {
	// When sending a turn we optimistically insert a local user entry (random id).
	// The server later emits the persisted `userMessage` item (stable id). Deduplicate by text so
	// the UI only shows the message that actually gets sent/persisted.
	if (next.kind === 'user') {
		const incoming = next as Extract<ChatEntry, { kind: 'user' }>;
		const matchIdx = entries.findIndex((e): e is Extract<ChatEntry, { kind: 'user' }> => e.kind === 'user' && e.text === incoming.text);
		if (matchIdx !== -1) {
			const prev = entries[matchIdx] as Extract<ChatEntry, { kind: 'user' }>;

			const mergedAttachments = (() => {
				const out: AttachmentItem[] = [];
				const seen = new Set<string>();
				for (const att of [...(prev.attachments ?? []), ...(incoming.attachments ?? [])]) {
					const key = attachmentDedupKey(att);
					if (seen.has(key)) continue;
					seen.add(key);
					out.push(att);
				}
				return out;
			})();

			const copy = [...entries];
			copy[matchIdx] = {
				...prev,
				...incoming,
				attachments: mergedAttachments.length > 0 ? mergedAttachments : undefined,
			};
			return copy;
		}
	}

	const idx = entries.findIndex((e) => e.id === next.id && e.kind === next.kind);
	if (idx === -1) return [...entries, next];
	const copy = [...entries];
	// Keep previously computed structured output unless the update explicitly sets it.
	if (next.kind === 'assistant') {
		const prev = copy[idx] as Extract<ChatEntry, { kind: 'assistant' }>;
		const incoming = next as Extract<ChatEntry, { kind: 'assistant' }>;
		const reasoningSummary = incoming.role === 'reasoning' ? (incoming.reasoningSummary ?? prev.reasoningSummary) : prev.reasoningSummary;
		const reasoningContent = incoming.role === 'reasoning' ? (incoming.reasoningContent ?? prev.reasoningContent) : prev.reasoningContent;
		const nextText = incoming.role === 'reasoning' ? buildReasoningText(reasoningSummary ?? [], reasoningContent ?? []) : (incoming.text ?? prev.text);
		copy[idx] = {
			...prev,
			...incoming,
			text: nextText,
			reasoningSummary,
			reasoningContent,
			structuredOutput: incoming.structuredOutput !== undefined ? incoming.structuredOutput : prev.structuredOutput,
		} as ChatEntry;
	} else {
		copy[idx] = { ...copy[idx], ...next } as ChatEntry;
	}
	return copy;
}

export function appendDelta(entries: ChatEntry[], id: string, role: 'message' | 'reasoning', delta: string): ChatEntry[] {
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
	const renderPlaceholder = role === 'message' ? shouldHideAssistantMessageContent(nextText) : existing.renderPlaceholderWhileStreaming;
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

export function applyReasoningDelta(entries: ChatEntry[], id: string, delta: string, index: number, target: 'summary' | 'content'): ChatEntry[] {
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

export function applyReasoningPartAdded(entries: ChatEntry[], id: string, index: number, target: 'summary' | 'content'): ChatEntry[] {
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

export function deriveTimelineFromThread(
	thread: CodexThread,
	options: { defaultCollapseDetails: boolean }
): {
	order: string[];
	turnsById: Record<string, TurnBlockData>;
	collapsedByEntryId: Record<string, boolean>;
	itemToTurnId: Record<string, string>;
} {
	const nextOrder: string[] = [];
	const nextTurns: Record<string, TurnBlockData> = {};
	const nextEntryCollapse: Record<string, boolean> = {};
	const nextItemToTurn: Record<string, string> = {};

	for (const turn of thread.turns ?? []) {
		const turnId = turn.id;
		if (!turnId) continue;
		nextOrder.push(turnId);

		const turnEntries: ChatEntry[] = [];
		let pendingReadGroupId: string | null = null;
		const items = turn.items ?? [];
		const isTurnStreaming = turn.status === 'inProgress';
		const lastIdx = items.length > 0 ? items.length - 1 : -1;
		for (const [idx, item] of items.entries()) {
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
					structuredOutput: completed ? (baseEntry.structuredOutput ?? null) : null,
				};
			}
			if (!entry) continue;
			turnEntries.push(entry);
			nextItemToTurn[entry.id] = turnId;
			if (isCollapsibleEntry(entry)) nextEntryCollapse[entry.id] = options.defaultCollapseDetails;

			// Read actions are rendered as a grouped "Read" block (see `mergeReadingEntries`).
			// We add the synthetic group id here so it can participate in the "gentle accordion" logic
			// and persist collapse state across thread refreshes.
			const canGroupRead = (() => {
				if (entry.kind !== 'command') return false;
				if (entry.approval) return false;
				const parsed = resolveParsedCmd(entry.command, entry.commandActions);
				return parsed.type === 'read';
			})();
			if (canGroupRead) {
				if (!pendingReadGroupId) {
					pendingReadGroupId = `read-group-${entry.id}`;
					nextEntryCollapse[pendingReadGroupId] = options.defaultCollapseDetails;
				}
			} else {
				pendingReadGroupId = null;
			}
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
		nextTurns[turnId] = { id: turnId, status: 'unknown', entries: [] };
	}

	return {
		order: nextOrder,
		turnsById: nextTurns,
		collapsedByEntryId: nextEntryCollapse,
		itemToTurnId: nextItemToTurn,
	};
}
