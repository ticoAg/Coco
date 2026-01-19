import type { CodexChatSettings } from '../codex/types';

const SETTINGS_STORAGE_KEY = 'coco.codexChat.settings.v2';
const SESSION_TREE_WIDTH_STORAGE_KEY = 'coco.codexChat.sessionTreeWidth.v1';
const PINNED_INPUT_ITEMS_STORAGE_KEY = 'coco.codexChat.pinnedInputItems.v1';

export const SESSION_TREE_MIN_WIDTH_PX = 200;
export const SESSION_TREE_MAX_WIDTH_PX = 520;

export type PinnedInputItem = { type: 'prompt' | 'skill'; name: string };

function safeString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function loadPinnedInputItems(): PinnedInputItem[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(PINNED_INPUT_ITEMS_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		const out: PinnedInputItem[] = [];
		for (const item of parsed) {
			if (!item || typeof item !== 'object') continue;
			const type = safeString((item as any).type);
			const name = safeString((item as any).name);
			if ((type === 'prompt' || type === 'skill') && name) {
				out.push({ type, name });
			}
		}
		return out;
	} catch {
		return [];
	}
}

export function persistPinnedInputItems(items: PinnedInputItem[]) {
	try {
		window.localStorage.setItem(PINNED_INPUT_ITEMS_STORAGE_KEY, JSON.stringify(items));
	} catch {
		// ignore
	}
}

export function loadCodexChatSettings(): CodexChatSettings {
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

export function persistCodexChatSettings(next: CodexChatSettings) {
	try {
		window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// ignore
	}
}

export function loadSessionTreeWidth(defaultWidth: number): number {
	if (typeof window === 'undefined') return defaultWidth;
	try {
		const raw = window.localStorage.getItem(SESSION_TREE_WIDTH_STORAGE_KEY);
		if (!raw) return defaultWidth;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return defaultWidth;
		return Math.min(SESSION_TREE_MAX_WIDTH_PX, Math.max(SESSION_TREE_MIN_WIDTH_PX, parsed));
	} catch {
		return defaultWidth;
	}
}

export function persistSessionTreeWidth(next: number) {
	try {
		window.localStorage.setItem(SESSION_TREE_WIDTH_STORAGE_KEY, String(next));
	} catch {
		// ignore
	}
}

