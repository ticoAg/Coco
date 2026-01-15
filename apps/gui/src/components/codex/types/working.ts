import type { ChatEntry } from './chat';

export type ReadingGroup = {
	kind: 'readingGroup';
	id: string;
	entries: Extract<ChatEntry, { kind: 'command' }>[];
};

export type WorkingItem = ChatEntry | ReadingGroup;

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
