import type { ChatEntry } from './chat';

export type TurnBlockStatus = 'inProgress' | 'completed' | 'failed' | 'interrupted' | 'unknown';

export type TurnBlockData = {
	id: string;
	status: TurnBlockStatus;
	entries: ChatEntry[];
};
