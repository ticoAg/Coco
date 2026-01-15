import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { message as dialogMessage, open as openDialog } from '@tauri-apps/plugin-dialog';
import { ArrowUp, Box, ChevronDown, ChevronRight, File, FileText, Folder, Image, Info, Menu, Plus, RotateCw, Settings, Slash, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { parseCodeReviewStructuredOutputFromMessage, shouldHideAssistantMessageContent } from './codex/assistantMessage';
import type {
	AttachmentItem,
	ChatEntry,
	CodexChatSettings,
	ReadingGroup,
	SegmentedWorkingItem,
	TurnBlockData,
	TurnBlockStatus,
	WorkingItem,
} from './codex/types';
import type { ApprovalPolicy } from './codex/types';
import {
	errorMessage,
	formatTokenCount,
	fuzzyMatch,
	normalizeCommandActions,
	normalizeMcpError,
	normalizeMcpResult,
	resolveParsedCmd,
	safeString,
} from './codex/utils';
import { MENU_STYLES, SIDEBAR_WIDTH_PX, SIDEBAR_ICON_BUTTON_PX } from './codex/styles/menu-styles';
import { SlashCommandMenu } from './codex/SlashCommandMenu';
import { SkillMenu } from './codex/SkillMenu';
import { StatusBar, type StatusPopover } from './codex/StatusBar';
import { SessionSidebar } from './codex/SessionSidebar';
import { SLASH_COMMANDS, type SlashCommand } from './codex/slash-commands';
import { TurnBlock, type TurnBlockView } from './codex/TurnBlock';
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

const SETTINGS_STORAGE_KEY = 'agentmesh.codexChat.settings.v2';

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
			defaultCollapseDetails: typeof parsed.defaultCollapseDetails === 'boolean' ? parsed.defaultCollapseDetails : defaults.defaultCollapseDetails,
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

function isCollapsibleEntry(entry: ChatEntry): entry is Extract<ChatEntry, { kind: 'command' | 'fileChange' | 'webSearch' | 'mcp' }> {
	return entry.kind === 'command' || entry.kind === 'fileChange' || entry.kind === 'webSearch' || entry.kind === 'mcp';
}

function repoNameFromPath(path: string): string {
	const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
	const parts = normalized.split('/').filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : path;
}

function wrapUserInputWithRepoContext(options: { userInput: string; currentRepoPath: string | null; relatedRepoPaths: string[] }): string {
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

function parseApprovalPolicyValue(value: unknown): ApprovalPolicy | null {
	if (value === 'untrusted' || value === 'on-failure' || value === 'on-request' || value === 'never') return value;
	return null;
}

function parseReasoningEffortValue(value: unknown): ReasoningEffort | null {
	if (value === 'none' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
		return value;
	}
	return null;
}

function normalizeProfileName(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	const doubleQuoted = trimmed.match(/^"(.*)"$/);
	if (doubleQuoted) return doubleQuoted[1] ?? '';
	const singleQuoted = trimmed.match(/^'(.*)'$/);
	if (singleQuoted) return singleQuoted[1] ?? '';
	return trimmed;
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

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

function applyReasoningDelta(entries: ChatEntry[], id: string, delta: string, index: number, target: 'summary' | 'content'): ChatEntry[] {
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

function applyReasoningPartAdded(entries: ChatEntry[], id: string, index: number, target: 'summary' | 'content'): ChatEntry[] {
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

function normalizeThreadFromResponse(res: unknown): CodexThread | null {
	if (!res || typeof res !== 'object') return null;
	const obj = res as Record<string, unknown>;
	const thread = obj.thread;
	if (!thread || typeof thread !== 'object') return null;
	return thread as CodexThread;
}

const PENDING_TURN_ID = '__pending__';

function isActivityEntry(entry: ChatEntry): entry is Extract<ChatEntry, { kind: 'command' | 'fileChange' | 'mcp' | 'webSearch' }> {
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

type FilteredSlashCommand = {
	cmd: SlashCommand;
	indices: number[] | null;
	score: number;
};

export function CodexChat() {
	const [settings, setSettings] = useState<CodexChatSettings>(() => loadCodexChatSettings());
	const [sessions, setSessions] = useState<CodexThreadSummary[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(true);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [isSessionsOpen, setIsSessionsOpen] = useState(false);
	const [runningThreadIds, setRunningThreadIds] = useState<Record<string, boolean>>({});

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

			const configuredModel = typeof config.model === 'string' ? config.model : null;
			const configuredEffort = parseReasoningEffortValue(config.model_reasoning_effort);
			const configuredApproval = parseApprovalPolicyValue(config.approval_policy);

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
			const nextEffort = selectedEffort && supportedEfforts.includes(selectedEffort) ? selectedEffort : (modelInfo?.defaultReasoningEffort ?? null);

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
				const nextTurns: Record<string, TurnBlockData> = {};
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
								structuredOutput: completed ? (baseEntry.structuredOutput ?? null) : null,
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

	const applyProfile = useCallback(
		async (nextProfile: string) => {
			if (nextProfile === selectedProfile) return;
			const runningFocusedTurn = activeTurnId ? turnsById[activeTurnId]?.status === 'inProgress' : false;
			if (runningFocusedTurn) {
				const confirmed = window.confirm('Switching profile will stop the running turn and resume the session. Continue?');
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

	const toggleTurnWorking = useCallback(
		(turnId: string) => {
			skipAutoScrollRef.current = true;
			const turn = turnsById[turnId];
			const collapsedExplicit = collapsedWorkingByTurnId[turnId];
			const currentOpen = collapsedExplicit === undefined ? turn?.status === 'inProgress' : !collapsedExplicit;
			const nextOpen = !currentOpen;
			const nextCollapsedExplicit = !nextOpen;

			if (turn && turn.status !== 'inProgress' && nextOpen) {
				const visible = settings.showReasoning ? turn.entries : turn.entries.filter((e) => e.kind !== 'assistant' || e.role !== 'reasoning');
				const assistantMessages = visible.filter(
					(e): e is Extract<ChatEntry, { kind: 'assistant'; role: 'message' }> => e.kind === 'assistant' && e.role === 'message'
				);
				const lastAssistantMessageId = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1]?.id : null;
				const workingEntries = visible.filter((e) => {
					if (isActivityEntry(e)) return true;
					if (e.kind === 'system') return true;
					if (e.kind === 'assistant' && e.role === 'reasoning') return true;
					if (e.kind === 'assistant' && e.role === 'message') return e.id !== lastAssistantMessageId;
					return false;
				});
				const explorationGroupIds = segmentExplorationItems(mergeReadingEntries(expandReasoningEntries(workingEntries)), false).flatMap((item) =>
					item.kind === 'exploration' ? [item.id] : []
				);

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
		},
		[collapsedWorkingByTurnId, settings.showReasoning, turnsById]
	);

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
		listSessions();
		void seedRunningThreads();
		loadModelsAndChatDefaults();
		void loadWorkspaceRoot();
		void loadRecentWorkspaces();
		void loadSkills();
		void loadPrompts();
	}, [listSessions, seedRunningThreads, loadModelsAndChatDefaults, loadWorkspaceRoot, loadRecentWorkspaces, loadSkills, loadPrompts]);

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

						const next: Record<string, TurnBlockData> = {
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
		const out: TurnBlockData[] = [];
		for (const id of turnOrder) {
			const turn = turnsById[id];
			if (turn) out.push(turn);
		}
		return out;
	}, [turnOrder, turnsById]);

	const renderTurns = useMemo<TurnBlockView[]>(() => {
		return turnBlocks.map((turn) => {
			const visible = settings.showReasoning ? turn.entries : turn.entries.filter((e) => e.kind !== 'assistant' || e.role !== 'reasoning');

			const userEntries = visible.filter((e) => e.kind === 'user') as Extract<ChatEntry, { kind: 'user' }>[];
			const assistantMessages = visible.filter(
				(e): e is Extract<ChatEntry, { kind: 'assistant'; role: 'message' }> => e.kind === 'assistant' && e.role === 'message'
			);
			const lastAssistantMessageId = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1]?.id : null;
			const assistantMessageEntries = lastAssistantMessageId ? assistantMessages.filter((e) => e.id === lastAssistantMessageId) : [];
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

	return (
		<div className="flex h-full min-w-0 flex-col overflow-x-hidden">
			{/* 自定义标题栏 */}
			<div className="flex h-10 shrink-0 items-center border-b border-white/10 bg-bg-panel/60" data-tauri-drag-region>
				{/* macOS 窗口按钮占位 */}
				<div className="w-20 shrink-0" data-tauri-drag-region />

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
								{activeThread?.cwd || workspaceRoot ? repoNameFromPath(activeThread?.cwd ?? workspaceRoot ?? '') : 'Select Project'}
							</span>
							<ChevronDown className="h-4 w-4 text-text-menuLabel" />
						</button>

						{isWorkspaceMenuOpen ? (
							<>
								<div className="fixed inset-0 z-40" onClick={() => setIsWorkspaceMenuOpen(false)} role="button" tabIndex={0} />
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
													{(activeThread?.cwd ?? workspaceRoot)
														? `~${(activeThread?.cwd ?? workspaceRoot ?? '').replace(/^\/Users\/[^/]+/, '')}`
														: 'No project selected'}
												</div>
											</div>
										</div>
										<ChevronRight className="h-4 w-4 shrink-0 text-text-menuLabel" />
									</button>

									<div className="mx-2 my-1.5 border-t border-border-menuDivider" />

									{/* New Window */}
									<button type="button" className={MENU_STYLES.popoverItem} onClick={() => void openNewWindow()}>
										<Box className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
										<span>New Window</span>
									</button>

									{/* Open Project */}
									<button type="button" className={MENU_STYLES.popoverItem} onClick={() => void openWorkspaceDialog()}>
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
																<div className="truncate text-[12px] font-medium text-text-main">{repoNameFromPath(path)}</div>
																<div className="truncate text-[11px] text-text-menuDesc">{`~${path.replace(/^\/Users\/[^/]+/, '')}`}</div>
															</div>
														</button>
													))}
											</div>
										</>
									) : null}

									<div className="mx-2 my-1.5 border-t border-border-menuDivider" />

									{/* About */}
									<button type="button" className={MENU_STYLES.popoverItem} onClick={() => void showAbout()}>
										<Info className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
										<span>About AgentMesh</span>
									</button>

									{/* Check for Updates */}
									<button type="button" className={MENU_STYLES.popoverItem} onClick={() => void showUpdates()}>
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

				<div className="flex-1" data-tauri-drag-region />

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
							<div className="fixed inset-0 z-40" onClick={() => setIsSettingsMenuOpen(false)} role="button" tabIndex={0} />
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
				<div className="relative shrink-0" style={{ width: SIDEBAR_WIDTH_PX }}>
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
						<div className="min-w-0 flex-1">{workspaceRootError ? <div className="mt-2 text-xs text-status-warning">{workspaceRootError}</div> : null}</div>

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

					<div ref={scrollRef} className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden pb-4">
						{renderTurns.map((turn) => (
							<TurnBlock
								key={turn.id}
								turn={turn}
								collapsedWorkingByTurnId={collapsedWorkingByTurnId}
								collapsedByEntryId={collapsedByEntryId}
								settings={settings}
								pendingTurnId={PENDING_TURN_ID}
								toggleTurnWorking={toggleTurnWorking}
								toggleEntryCollapse={toggleEntryCollapse}
								approve={approve}
							/>
						))}
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
											<SkillMenu
												skills={skills}
												filteredSkills={filteredSkills}
												highlightIndex={skillHighlightIndex}
												onHighlight={setSkillHighlightIndex}
												onSelect={executeSkillSelection}
											/>
										) : isSlashMenuOpen ? (
											<SlashCommandMenu
												filteredCommands={filteredSlashCommands}
												filteredPrompts={filteredPromptsForSlashMenu}
												filteredSkills={filteredSkillsForSlashMenu}
												highlightIndex={slashHighlightIndex}
												onHighlight={setSlashHighlightIndex}
												onSelectCommand={executeSlashCommand}
												onSelectPrompt={executePromptSelection}
												onSelectSkill={executeSkillSelection}
											/>
										) : (
											// File search results
											<>
												{fileSearchResults.length > 0 ? (
													fileSearchResults.map((f) => (
														<button key={f.path} type="button" className={MENU_STYLES.popoverItem} onClick={() => void addFileAttachment(f)}>
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
											<button type="button" className={MENU_STYLES.popoverItem} onClick={() => fileInputRef.current?.click()}>
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
									<div key={f.path} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-bg-panelHover px-2 py-1 text-xs">
										{f.content?.startsWith('data:image') ? <Image className="h-3.5 w-3.5 text-text-dim" /> : <File className="h-3.5 w-3.5 text-text-dim" />}
										<span className="max-w-[120px] truncate">{f.name}</span>
										<button type="button" className="rounded p-0.5 hover:bg-white/10" onClick={() => removeFileAttachment(f.path)}>
											<X className="h-3 w-3" />
										</button>
									</div>
								))}
							</div>
						) : null}

						{/* Hidden file input for image upload */}
						<input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

						{/* Input area with inline tags for skill/prompt */}
						<div className="flex flex-wrap items-start gap-1.5">
							{/* Selected prompt - inline tag */}
							{selectedPrompt ? (
								<div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">
									<FileText className="h-3.5 w-3.5" />
									<span className="max-w-[160px] truncate">prompts:{selectedPrompt.name}</span>
									<button type="button" className="rounded p-0.5 hover:bg-blue-500/20" onClick={() => setSelectedPrompt(null)}>
										<X className="h-3 w-3" />
									</button>
								</div>
							) : null}
							{/* Selected skill - inline tag */}
							{selectedSkill ? (
								<div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
									<Zap className="h-3.5 w-3.5" />
									<span className="max-w-[160px] truncate">{selectedSkill.name}</span>
									<button type="button" className="rounded p-0.5 hover:bg-primary/20" onClick={() => setSelectedSkill(null)}>
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
								<button type="button" className="am-icon-button h-7 w-7" title="Add context" onClick={() => setIsAddContextOpen((v) => !v)}>
									<Plus className="h-3.5 w-3.5" />
								</button>

								{/* / Slash Commands Button */}
								<button type="button" className="am-icon-button h-7 w-7" title="Commands" onClick={() => setIsSlashMenuOpen((v) => !v)}>
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
											? `cwd: ${autoContext.cwd}\nRecent: ${autoContext.recentFiles.length} files\nGit: ${autoContext.gitStatus?.branch ?? 'N/A'}`
											: 'Auto context'
									}
								>
									<span>Auto context</span>
									{autoContext?.gitStatus ? (
										<span className="rounded bg-white/10 px-1 py-0.5 text-[10px] leading-none">{autoContext.gitStatus.branch}</span>
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
									<svg className="absolute inset-0 h-full w-full animate-spin" viewBox="0 0 32 32">
										<circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/20" />
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
					/>

					{isConfigOpen ? (
						<div className="fixed inset-0 z-50 flex">
							<div className="flex-1 bg-black/60" onClick={() => setIsConfigOpen(false)} role="button" tabIndex={0} />
							<div className="w-[520px] max-w-[90vw] border-l border-white/10 bg-bg-panel/95 p-6 backdrop-blur">
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

					<SessionSidebar
						isOpen={isSessionsOpen}
						sessions={sessions}
						loading={sessionsLoading}
						error={sessionsError}
						selectedThreadId={selectedThreadId}
						runningThreadIds={runningThreadIds}
						onRefresh={listSessions}
						onClose={() => setIsSessionsOpen(false)}
						onSelect={selectSession}
					/>

					{isSettingsOpen ? (
						<div className="fixed inset-0 z-50 flex">
							<div className="flex-1 bg-black/60" onClick={() => setIsSettingsOpen(false)} role="button" tabIndex={0} />
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
												<div className="truncate">
													{diagnostics.envOverride ? `AGENTMESH_CODEX_BIN: ${diagnostics.envOverride}` : 'AGENTMESH_CODEX_BIN: (unset)'}
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
