import type { DiffLineKind, ParsedFileChangeKind, ParsedDiff, ParsedDiffLine, DiffReviewChange, FileChangeSummary } from '../types/diff';
import type { ChatEntry } from '../types/chat';

export function formatDiffPath(path: string, movePath?: string): string {
	if (movePath && movePath !== path) return `${path} → ${movePath}`;
	return path;
}

export function fileChangeVerb(kind: ParsedFileChangeKind, isPending: boolean): string {
	if (isPending) {
		return kind.type === 'add' ? 'Adding' : kind.type === 'delete' ? 'Deleting' : 'Editing';
	}
	return kind.type === 'add' ? 'Added' : kind.type === 'delete' ? 'Deleted' : 'Edited';
}

export function parseFileChangeKind(kind: unknown): ParsedFileChangeKind {
	const kindStr = String(kind);
	// Handle move operations: "rename" or "move"
	if (kindStr.startsWith('rename') || kindStr.startsWith('move')) {
		const parts = kindStr.split(':');
		if (parts.length >= 3) {
			return { type: 'update', movePath: parts[2] };
		}
		return { type: 'update' };
	}
	// Handle simple operations
	if (kindStr === 'add' || kindStr === 'created') {
		return { type: 'add' };
	}
	if (kindStr === 'delete' || kindStr === 'removed') {
		return { type: 'delete' };
	}
	return { type: 'update' };
}

function collapseDiffContext(lines: ParsedDiffLine[], contextLines: number): ParsedDiffLine[] {
	if (contextLines <= 0) return lines;
	const out: ParsedDiffLine[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.kind !== 'context') {
			out.push(line);
			i += 1;
			continue;
		}
		let j = i;
		while (j < lines.length && lines[j]?.kind === 'context') {
			j += 1;
		}
		const runLength = j - i;
		if (runLength <= contextLines * 2) {
			out.push(...lines.slice(i, j));
		} else {
			out.push(...lines.slice(i, i + contextLines));
			out.push({ kind: 'ellipsis', text: '⋮' });
			out.push(...lines.slice(j - contextLines, j));
		}
		i = j;
	}
	return out;
}

export function parseUnifiedDiff(diff: string): ParsedDiff {
	const rawLines = diff.split(/\r?\n/);
	let oldLine = 0;
	let newLine = 0;
	let sawHunk = false;
	let added = 0;
	let removed = 0;
	const lines: ParsedDiffLine[] = [];
	let inHunk = false;

	const pushLine = (kind: DiffLineKind, text: string, oldLine?: number, newLine?: number) => {
		lines.push({ kind, text, oldLine, newLine });
	};

	for (const raw of rawLines) {
		const line = raw.replace(/\r$/, '');
		const hunkMatch = line.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
		if (hunkMatch) {
			if (sawHunk) {
				pushLine('ellipsis', '⋮');
			}
			sawHunk = true;
			inHunk = true;
			oldLine = Number(hunkMatch[1]);
			newLine = Number(hunkMatch[2]);
			continue;
		}

		if (!inHunk) {
			continue;
		}

		if (line.startsWith('+') && !line.startsWith('+++')) {
			const text = line.slice(1);
			pushLine('insert', text, undefined, newLine);
			newLine += 1;
			added += 1;
			continue;
		}
		if (line.startsWith('-') && !line.startsWith('---')) {
			const text = line.slice(1);
			pushLine('delete', text, oldLine, undefined);
			oldLine += 1;
			removed += 1;
			continue;
		}
		if (line.startsWith(' ')) {
			const text = line.slice(1);
			pushLine('context', text, oldLine, newLine);
			oldLine += 1;
			newLine += 1;
			continue;
		}
	}

	if (!sawHunk) {
		let fallbackOld = 1;
		let fallbackNew = 1;
		for (const raw of rawLines) {
			const line = raw.replace(/\r$/, '');
			if (line.startsWith('+') && !line.startsWith('+++')) {
				pushLine('insert', line.slice(1), undefined, fallbackNew);
				fallbackNew += 1;
				added += 1;
				continue;
			}
			if (line.startsWith('-') && !line.startsWith('---')) {
				pushLine('delete', line.slice(1), fallbackOld, undefined);
				fallbackOld += 1;
				removed += 1;
				continue;
			}
			if (line.startsWith(' ')) {
				pushLine('context', line.slice(1), fallbackOld, fallbackNew);
				fallbackOld += 1;
				fallbackNew += 1;
			}
		}
	}

	const collapsed = collapseDiffContext(lines, 3);
	const maxLineNumber = collapsed.reduce((max, line) => {
		let next = max;
		if (typeof line.oldLine === 'number') next = Math.max(next, line.oldLine);
		if (typeof line.newLine === 'number') next = Math.max(next, line.newLine);
		return next;
	}, 0);
	return {
		lines: collapsed,
		added,
		removed,
		lineNumberWidth: Math.max(1, maxLineNumber).toString().length,
	};
}

export function diffHasLineNumbers(diff: string): boolean {
	return /^@@\s*-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s*@@/m.test(diff);
}

export function stripDiffLineNumbers(parsed: ParsedDiff): ParsedDiff {
	if (!parsed.lines.length) return parsed;
	return {
		...parsed,
		lines: parsed.lines.map((line) => ({ ...line, oldLine: undefined, newLine: undefined })),
		lineNumberWidth: 1,
	};
}

export function parseDiffForChange(diff: string, kind: ParsedFileChangeKind, lineNumbersAvailable?: boolean): ParsedDiff {
	const shouldUseNumbers = lineNumbersAvailable ?? diffHasLineNumbers(diff);
	const parsed = parseUnifiedDiff(diff);
	const normalized = shouldUseNumbers ? parsed : stripDiffLineNumbers(parsed);
	if (normalized.lines.length > 0 || !diff) return normalized;
	if (kind.type !== 'add' && kind.type !== 'delete') return normalized;

	const rawLines = diff.split(/\r?\n/);
	const trimmedLines = rawLines.length > 0 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
	const contentLines = trimmedLines.filter(
		(line) => !(line.startsWith('*** ') || line.startsWith('+++') || line.startsWith('---') || line.startsWith('Index: '))
	);
	let lineNumber = 1;
	const lines: ParsedDiffLine[] = [];
	for (const line of contentLines) {
		lines.push({
			kind: kind.type === 'add' ? 'insert' : 'delete',
			text: line,
			oldLine: kind.type === 'delete' ? lineNumber : undefined,
			newLine: kind.type === 'add' ? lineNumber : undefined,
		});
		lineNumber += 1;
	}
	const count = contentLines.length;
	const fallback: ParsedDiff = {
		lines,
		added: kind.type === 'add' ? count : 0,
		removed: kind.type === 'delete' ? count : 0,
		lineNumberWidth: Math.max(1, count).toString().length,
	};
	return shouldUseNumbers ? fallback : stripDiffLineNumbers(fallback);
}

export function buildFileChangeSummary(entry: Extract<ChatEntry, { kind: 'fileChange' }>): FileChangeSummary {
	const changes: DiffReviewChange[] = entry.changes.map((change) => {
		const kind = parseFileChangeKind(change.kind);
		const diff = change.diff ?? '';
		const parsed = parseDiffForChange(diff, kind, change.lineNumbersAvailable);
		return {
			path: change.path,
			movePath: kind.movePath,
			kind,
			diff,
			parsed,
			lineNumbersAvailable: change.lineNumbersAvailable,
		};
	});
	const totalAdded = changes.reduce((sum, change) => sum + change.parsed.added, 0);
	const totalRemoved = changes.reduce((sum, change) => sum + change.parsed.removed, 0);
	const fileCount = changes.length;
	const single = fileCount === 1;
	const primaryKind = single ? changes[0]?.kind.type : 'update';
	const titlePrefix = primaryKind === 'add' ? 'Added' : primaryKind === 'delete' ? 'Deleted' : 'Edited';
	const titleContent = single ? formatDiffPath(changes[0]?.path ?? 'file', changes[0]?.movePath) : `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
	return {
		id: entry.id,
		titlePrefix,
		titleContent,
		totalAdded,
		totalRemoved,
		changes,
	};
}
