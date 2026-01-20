import { resolveParsedCmd } from '../../codex/utils';
import type { ChatEntry, ReasoningGroup, WorkingItem } from '../../codex/types';

export type ExplorationCounts = { uniqueReadFileCount: number; searchCount: number; listCount: number };

export function isReadingGroup(item: WorkingItem | undefined): item is Extract<WorkingItem, { kind: 'readingGroup' }> {
	return !!item && 'kind' in item && item.kind === 'readingGroup';
}

export function isReasoningGroup(item: WorkingItem | undefined): item is ReasoningGroup {
	return !!item && 'kind' in item && item.kind === 'reasoningGroup';
}

export function countExplorationCounts(items: WorkingItem[]): ExplorationCounts {
	const files = new Set<string>();
	let searchCount = 0;
	let listCount = 0;

	const visitCommand = (entry: Extract<ChatEntry, { kind: 'command' }>) => {
		const parsed = resolveParsedCmd(entry.command, entry.commandActions);
		if (parsed.type === 'read' && parsed.name) files.add(parsed.name);
		if (parsed.type === 'search') searchCount += 1;
		if (parsed.type === 'list_files') listCount += 1;
	};

	for (const item of items) {
		if (isReadingGroup(item)) {
			for (const entry of item.entries) visitCommand(entry);
			continue;
		}
		if (item.kind === 'command') {
			visitCommand(item);
		}
	}

	return { uniqueReadFileCount: files.size, searchCount, listCount };
}

export function formatExplorationCounts(counts: ExplorationCounts): string {
	const parts: string[] = [];
	if (counts.uniqueReadFileCount > 0) parts.push(`${counts.uniqueReadFileCount} ${counts.uniqueReadFileCount === 1 ? 'file' : 'files'}`);
	if (counts.searchCount > 0) parts.push(`${counts.searchCount} ${counts.searchCount === 1 ? 'search' : 'searches'}`);
	// Match VSCode Codex plugin: "N list" (no plural).
	if (counts.listCount > 0) parts.push(`${counts.listCount} list`);
	return parts.join(', ');
}
