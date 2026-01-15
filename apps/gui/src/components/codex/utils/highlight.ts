import type React from 'react';
import { createElement } from 'react';

/**
 * 高亮匹配的字符
 */
export function highlightMatches(text: string, indices: number[]): React.ReactNode {
	if (!indices || indices.length === 0) return text;

	const result: React.ReactNode[] = [];
	let lastIdx = 0;

	for (const idx of indices) {
		if (idx > lastIdx) {
			result.push(text.slice(lastIdx, idx));
		}
		result.push(createElement('span', { key: idx, className: 'text-primary font-semibold' }, text[idx]));
		lastIdx = idx + 1;
	}

	if (lastIdx < text.length) {
		result.push(text.slice(lastIdx));
	}

	return result;
}
