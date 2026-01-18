import type { ChatEntry } from './chat';

export type ReadingGroup = {
	kind: 'readingGroup';
	id: string;
	entries: Extract<ChatEntry, { kind: 'command' }>[];
};

export type ReasoningGroup = {
	kind: 'reasoningGroup';
	id: string;
	entries: Extract<ChatEntry, { kind: 'assistant'; role: 'reasoning' }>[];
};

export type WorkingItem = ChatEntry | ReadingGroup | ReasoningGroup;

export type SegmentedWorkingItem =
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
