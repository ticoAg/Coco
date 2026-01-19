import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import type { CodexJsonRpcEvent, CodexThreadItem } from '@/types/codex';
import type { ChatEntry, TurnBlockData } from '../codex/types';
import { parseCodeReviewStructuredOutputFromMessage, shouldHideAssistantMessageContent } from '../codex/assistantMessage';
import { safeString } from '../codex/utils';
import {
	PENDING_TURN_ID,
	appendDelta,
	applyReasoningDelta,
	applyReasoningPartAdded,
	entryFromThreadItem,
	isCollapsibleEntry,
	mergeEntry,
	parseTurnStatus,
} from './threadTimeline';

type UseCodexJsonRpcEventsArgs = {
	selectedThreadId: string | null;
	activeTurnId: string | null;
	pendingTurnId?: string;
	defaultCollapseDetails: boolean;
	itemToTurnRef: React.MutableRefObject<Record<string, string>>;
	setItemToTurnId: (value: Record<string, string>) => void;
	setThreadRunning: (threadId: string, running: boolean) => void;
	ingestCollabItems: (threadId: string, items: Array<Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>>) => void;
	setThreadTokenUsage: (value: { totalTokens: number; contextWindow: number | null } | null) => void;
	setActiveTurnId: (value: string | null) => void;
	setTurnOrder: React.Dispatch<React.SetStateAction<string[]>>;
	setTurnsById: React.Dispatch<React.SetStateAction<Record<string, TurnBlockData>>>;
	setCollapsedByEntryId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

export function useCodexJsonRpcEvents({
	selectedThreadId,
	activeTurnId,
	pendingTurnId = PENDING_TURN_ID,
	defaultCollapseDetails,
	itemToTurnRef,
	setItemToTurnId,
	setThreadRunning,
	ingestCollabItems,
	setThreadTokenUsage,
	setActiveTurnId,
	setTurnOrder,
	setTurnsById,
	setCollapsedByEntryId,
}: UseCodexJsonRpcEventsArgs) {
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

				// Collab tool calls are useful to keep even when we are not focused on that thread,
				// since they define the thread graph and agent state updates.
				if ((method === 'item/started' || method === 'item/completed') && threadId) {
					const item = params?.item as CodexThreadItem | undefined;
					const rawType = safeString((item as unknown as { type?: unknown })?.type);
					const typeKey = rawType.replace(/[-_]/g, '').toLowerCase();
					if (typeKey === 'collabagenttoolcall' && item) {
						ingestCollabItems(threadId, [item as Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>]);
					}
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
						const withoutPending = prev.filter((id) => id !== pendingTurnId);
						if (withoutPending.includes(turnId)) return withoutPending;
						return [...withoutPending, turnId];
					});
					setTurnsById((prev) => {
						const pending = prev[pendingTurnId];
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
						delete next[pendingTurnId];
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
					const turnId = explicitTurnId || activeTurnId || pendingTurnId;

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
						return { ...prev, [entry.id]: defaultCollapseDetails };
					});
					return;
				}

				if (method === 'item/agentMessage/delta') {
					const itemId = safeString(params?.itemId);
					const delta = safeString(params?.delta);
					if (!itemId || !delta) return;
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? pendingTurnId;
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
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? pendingTurnId;
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
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? pendingTurnId;
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
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? pendingTurnId;
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
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? pendingTurnId;
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
					const turnId = itemToTurnRef.current[itemId] ?? activeTurnId ?? pendingTurnId;
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
					const turnId = activeTurnId ?? pendingTurnId;
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
					const turnId = explicitTurnId || itemToTurnRef.current[itemId] || activeTurnId || pendingTurnId;
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
					const turnId = explicitTurnId || itemToTurnRef.current[itemId] || activeTurnId || pendingTurnId;
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
	}, [activeTurnId, defaultCollapseDetails, ingestCollabItems, itemToTurnRef, pendingTurnId, selectedThreadId, setThreadRunning, setThreadTokenUsage]);
}

