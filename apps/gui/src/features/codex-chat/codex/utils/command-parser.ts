import type { ParsedCmd } from '../types/command';
import type { CommandAction } from '@/types/codex';
import { isRecord, safeString } from './formatters';

export function stripOuterQuotes(value: string): string {
	const trimmed = value.trim();
	const isSingleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'");
	const isDoubleQuoted = trimmed.startsWith('"') && trimmed.endsWith('"');
	if (!isSingleQuoted && !isDoubleQuoted) return trimmed;
	let inner = trimmed.slice(1, -1);
	if (isSingleQuoted) {
		inner = inner.replace(/'\"'\"'/g, "'");
	} else {
		inner = inner.replace(/\\"/g, '"');
	}
	return inner;
}

export function unwrapShellCommand(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) return trimmed;
	const patterns = [/^(?:\/bin\/)?(?:bash|zsh|sh)\s+-lc\s+([\s\S]+)$/i, /^(?:\/bin\/)?(?:bash|zsh|sh)\s+(?:-l\s+)?-c\s+([\s\S]+)$/i];
	for (const pattern of patterns) {
		const match = trimmed.match(pattern);
		if (match && match[1]) {
			return stripOuterQuotes(match[1]);
		}
	}
	return trimmed;
}

export function normalizeShellCommand(command: string): string {
	const unwrapped = unwrapShellCommand(command);
	return unwrapped.replace(/^\$\s+/, '').trim();
}

export function splitPipeSegments(command: string): string[] {
	const segments: string[] = [];
	let buffer = '';
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < command.length; i += 1) {
		const char = command[i];
		if (char === "'" && !inDouble) {
			inSingle = !inSingle;
			buffer += char;
			continue;
		}
		if (char === '"' && !inSingle) {
			inDouble = !inDouble;
			buffer += char;
			continue;
		}
		if (char === '|' && !inSingle && !inDouble) {
			const trimmed = buffer.trim();
			if (trimmed) segments.push(trimmed);
			buffer = '';
			continue;
		}
		buffer += char;
	}
	const tail = buffer.trim();
	if (tail) segments.push(tail);
	return segments;
}

export function extractLastPathArg(command: string): string | undefined {
	const match = command.match(/(?:^|\s)([^\s"']+|"[^"]+"|'[^']+')\s*$/);
	if (!match) return undefined;
	const token = stripOuterQuotes(match[1]);
	if (!token || token.startsWith('-')) return undefined;
	return token;
}

function parseCommandSingle(cmdString: string): ParsedCmd {
	const cmd = cmdString.trim();
	if (!cmd) {
		return { type: 'unknown', cmd: '' };
	}
	const lowerCmd = cmd.toLowerCase();

	// Pattern: grep/rg/ag search commands
	if (/^(grep|rg|ag|ack)\s/.test(lowerCmd)) {
		const match = cmd.match(/^(?:grep|rg|ag|ack)\s+(?:-[^\s]+\s+)*['"]?([^'"]+)['"]?\s*(.*)$/i);
		if (match) {
			return { type: 'search', cmd, query: match[1], path: match[2] || undefined };
		}
		return { type: 'search', cmd };
	}

	// Pattern: find command
	if (/^find\s/.test(lowerCmd)) {
		const match = cmd.match(/-name\s+['"]?([^'"]+)['"]?/i);
		if (match) {
			return { type: 'search', cmd, query: match[1] };
		}
		return { type: 'list_files', cmd };
	}

	// Pattern: ls/dir/tree commands
	if (/^(ls|dir|tree)\b/.test(lowerCmd)) {
		const parts = cmd
			.split(/\s+/)
			.slice(1)
			.filter((part) => part && !part.startsWith('-'));
		const path = parts.length > 0 ? parts[0] : undefined;
		return { type: 'list_files', cmd, path };
	}

	// Pattern: cat/head/tail/less/more (read file)
	if (/^(cat|head|tail|less|more|bat)\s/.test(lowerCmd)) {
		// Many of these commands accept options with values (e.g. `head -c 400 file`),
		// so "first arg after flags" is often not the filename. Prefer the last
		// non-flag token as a best-effort path.
		const name = extractLastPathArg(cmd);
		if (name) return { type: 'read', cmd, name };
		return { type: 'read', cmd };
	}

	// Pattern: sed/nl (read file; ignore in-place edits)
	if (/^sed\b/.test(lowerCmd)) {
		const hasInPlace = /(^|\s)-i\b/.test(lowerCmd) || /--in-place\b/.test(lowerCmd);
		if (hasInPlace) {
			return { type: 'unknown', cmd };
		}
		const name = extractLastPathArg(cmd);
		if (name) return { type: 'read', cmd, name };
		return { type: 'unknown', cmd };
	}
	if (/^nl\b/.test(lowerCmd)) {
		const name = extractLastPathArg(cmd);
		if (name) return { type: 'read', cmd, name };
		return { type: 'unknown', cmd };
	}

	// Pattern: format/prettier/black/gofmt
	if (/^(prettier|black|gofmt|rustfmt|clang-format|autopep8)\b/.test(lowerCmd)) {
		return { type: 'format', cmd };
	}

	// Pattern: test commands
	if (/^(npm\s+test|yarn\s+test|pytest|jest|cargo\s+test|go\s+test|rspec|mocha)\b/.test(lowerCmd)) {
		return { type: 'test', cmd };
	}

	// Pattern: lint commands
	if (/^(eslint|pylint|flake8|clippy|golint|tslint|rubocop)\b/.test(lowerCmd)) {
		return { type: 'lint', cmd };
	}

	// Pattern: echo/true/: (noop)
	if (/^(echo|true|:)\b/.test(lowerCmd)) {
		return { type: 'noop', cmd };
	}

	return { type: 'unknown', cmd };
}

/**
 * Parse a command string to extract semantic type and parameters.
 * Matches VS Code Codex plugin's command classification logic.
 */
export function parseCommand(cmdString: string): ParsedCmd {
	const cmd = normalizeShellCommand(cmdString ?? '');
	if (!cmd) return { type: 'unknown', cmd: '' };
	const segments = splitPipeSegments(cmd);
	if (segments.length > 1) {
		for (const segment of segments) {
			const parsed = parseCommandSingle(segment);
			if (parsed.type !== 'unknown') return parsed;
		}
	}
	return parseCommandSingle(cmd);
}

export function normalizeCommandActions(value: unknown): CommandAction[] {
	if (!Array.isArray(value)) return [];
	const out: CommandAction[] = [];
	for (const action of value) {
		if (!isRecord(action)) continue;
		const type = safeString(action.type);
		const command = safeString(action.command);
		if (!type || !command) continue;
		if (type === 'read') {
			const name = safeString(action.name);
			const path = safeString(action.path) || name;
			if (!name) continue;
			out.push({ type: 'read', command, name, path });
			continue;
		}
		if (type === 'listFiles') {
			const path = safeString(action.path) || undefined;
			out.push({ type: 'listFiles', command, path: path || undefined });
			continue;
		}
		if (type === 'search') {
			const query = safeString(action.query) || undefined;
			const path = safeString(action.path) || undefined;
			out.push({ type: 'search', command, query, path });
			continue;
		}
		if (type === 'unknown') {
			out.push({ type: 'unknown', command });
		}
	}
	return out;
}

function parsedCmdFromAction(action: CommandAction): ParsedCmd {
	switch (action.type) {
		case 'read':
			return { type: 'read', cmd: action.command, name: action.name, path: action.path };
		case 'listFiles':
			return { type: 'list_files', cmd: action.command, path: action.path ?? undefined };
		case 'search':
			return {
				type: 'search',
				cmd: action.command,
				query: action.query ?? undefined,
				path: action.path ?? undefined,
			};
		case 'unknown':
		default:
			return { type: 'unknown', cmd: action.command };
	}
}

export function resolveParsedCmd(command: string, commandActions?: CommandAction[]): ParsedCmd {
	const actions = Array.isArray(commandActions) ? commandActions : [];
	if (actions.length > 0) {
		return parsedCmdFromAction(actions[0]);
	}
	return parseCommand(command);
}

/**
 * Generate a smart summary for a parsed command.
 * Matches VS Code Codex plugin's CmdSummaryText behavior.
 */
export function getCmdSummary(parsed: ParsedCmd, isFinished: boolean, rawCommand?: string): { prefix: string; content: string } {
	switch (parsed.type) {
		case 'search':
			if (parsed.query && parsed.path) {
				return {
					prefix: isFinished ? 'Searched for' : 'Searching for',
					content: `${parsed.query} in ${parsed.path}`,
				};
			}
			if (parsed.query) {
				return {
					prefix: isFinished ? 'Searched for' : 'Searching for',
					content: parsed.query,
				};
			}
			return {
				prefix: isFinished ? 'Searched for' : 'Searching for',
				content: 'files',
			};
		case 'read':
			return {
				prefix: isFinished ? 'Read' : 'Reading',
				content: parsed.name || 'file',
			};
		case 'list_files':
			if (parsed.path) {
				return {
					prefix: isFinished ? 'Listed files in' : 'Listing files in',
					content: parsed.path,
				};
			}
			return {
				prefix: isFinished ? 'Explored' : 'Exploring',
				content: 'files',
			};
		case 'format':
		case 'test':
		case 'lint':
		case 'noop':
		case 'unknown':
		default:
			return {
				prefix: isFinished ? 'Ran' : 'Running',
				content: rawCommand?.trim() || parsed.cmd,
			};
	}
}

export function normalizeCommandOutput(output: string | null): string {
	if (!output) return '';
	const lines = output.replace(/\r\n?/g, '\n').split('\n');
	const filtered = lines.filter((line) => {
		const trimmed = line.trim();
		if (!trimmed) return true;
		if (/^Chunk ID:/.test(trimmed)) return false;
		if (/^Wall time:/.test(trimmed)) return false;
		if (/^Process exited with code/.test(trimmed)) return false;
		if (/^Original token count:/.test(trimmed)) return false;
		if (/^Output:\s*$/.test(trimmed)) return false;
		return true;
	});
	let result = filtered.join('\n');
	result = result.replace(/^\s*\n+/, '');
	return result;
}

function formatCommandLine(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) return '';
	const escaped = trimmed.replace(/'/g, `'\"'\"'`);
	return `$ '${escaped}'`;
}

export function prefixCommandLine(command: string, output: string | null): string {
	const cleaned = normalizeCommandOutput(output);
	const cmdLine = formatCommandLine(command);
	if (!cmdLine) return cleaned;
	const lines = cleaned.replace(/\r\n?/g, '\n').split('\n');
	const firstNonEmpty = lines.find((line) => line.trim() !== '');
	if (firstNonEmpty && firstNonEmpty.startsWith('$')) return cleaned;
	return cleaned ? `${cmdLine}\n${cleaned}` : cmdLine;
}
