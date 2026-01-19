import type { ChatEntry, TurnBlockData } from '../codex/types';
import type { TurnBlockView } from '../codex/TurnBlock';
import {
	countRenderedWorkingItems,
	countWorkingItems,
	expandReasoningEntries,
	isActivityEntry,
	mergeReadingEntries,
	mergeReasoningEntries,
	segmentExplorationItems,
} from './threadTimeline';

export function buildTurnBlockViews(turnBlocks: TurnBlockData[], showReasoning: boolean): TurnBlockView[] {
	return turnBlocks.map((turn) => {
		const visible = showReasoning ? turn.entries : turn.entries.filter((e) => e.kind !== 'assistant' || e.role !== 'reasoning');

		const userEntries = visible.filter((e) => e.kind === 'user') as Array<Extract<ChatEntry, { kind: 'user' }>>;
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
		const mergedReadingItems = mergeReadingEntries(expandedWorkingEntries);
		const mergedWorkingItems = mergeReasoningEntries(mergedReadingItems);
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
}
