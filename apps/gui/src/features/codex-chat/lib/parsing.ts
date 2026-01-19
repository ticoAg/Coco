import type { ApprovalPolicy } from '../codex/types';
import type { ReasoningEffort } from '@/types/codex';

export function repoNameFromPath(path: string): string {
	const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
	const parts = normalized.split('/').filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function wrapUserInputWithRepoContext(options: { userInput: string; currentRepoPath: string | null; relatedRepoPaths: string[] }): string {
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

export function parseApprovalPolicyValue(value: unknown): ApprovalPolicy | null {
	if (value === 'untrusted' || value === 'on-failure' || value === 'on-request' || value === 'never') return value;
	return null;
}

export function parseReasoningEffortValue(value: unknown): ReasoningEffort | null {
	if (value === 'none' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
		return value;
	}
	return null;
}

export function normalizeProfileName(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	const doubleQuoted = trimmed.match(/^"(.*)"$/);
	if (doubleQuoted) return doubleQuoted[1] ?? '';
	const singleQuoted = trimmed.match(/^'(.*)'$/);
	if (singleQuoted) return singleQuoted[1] ?? '';
	return trimmed;
}

export function uniqueStrings(values: string[]): string[] {
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

