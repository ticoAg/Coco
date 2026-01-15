import type React from 'react';
import { createElement } from 'react';

type AnsiTextStyle = {
	fgClass?: string;
	bgClass?: string;
	bold?: boolean;
	dim?: boolean;
	underline?: boolean;
};

function ansiColorClass(code: number): string | undefined {
	// Basic 16-color-ish mapping (focus on common git colors: red/green/yellow).
	switch (code) {
		// Normal
		case 30:
			return 'text-black';
		case 31:
			return 'text-red-400';
		case 32:
			return 'text-green-400';
		case 33:
			return 'text-yellow-400';
		case 34:
			return 'text-blue-400';
		case 35:
			return 'text-fuchsia-400';
		case 36:
			return 'text-cyan-400';
		case 37:
			return 'text-text-muted';
		// Bright
		case 90:
			return 'text-zinc-500';
		case 91:
			return 'text-red-400';
		case 92:
			return 'text-green-400';
		case 93:
			return 'text-yellow-400';
		case 94:
			return 'text-sky-400';
		case 95:
			return 'text-fuchsia-300';
		case 96:
			return 'text-cyan-300';
		case 97:
			return 'text-zinc-100';
		default:
			return undefined;
	}
}

function ansiBgClass(code: number): string | undefined {
	// Keep conservative: only a handful of backgrounds.
	switch (code) {
		case 40:
			return 'bg-black';
		case 41:
			return 'bg-red-600/30';
		case 42:
			return 'bg-green-600/30';
		case 43:
			return 'bg-yellow-600/30';
		case 44:
			return 'bg-blue-600/30';
		case 45:
			return 'bg-fuchsia-600/30';
		case 46:
			return 'bg-cyan-600/30';
		case 47:
			return 'bg-white/10';
		default:
			return undefined;
	}
}

export function renderAnsiText(text: string): React.ReactNode {
	// Parse SGR sequences like: \x1b[32m ... \x1b[0m
	const parts: React.ReactNode[] = [];
	const re = /\x1b\[([0-9;]*)m/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	let style: AnsiTextStyle = {};
	let segmentKey = 0;

	const pushText = (chunk: string) => {
		if (!chunk) return;
		const classNames = [
			style.fgClass,
			style.bgClass,
			style.bold ? 'font-semibold' : undefined,
			style.dim ? 'opacity-70' : undefined,
			style.underline ? 'underline' : undefined,
		]
			.filter(Boolean)
			.join(' ');

		if (!classNames) {
			parts.push(chunk);
			return;
		}

		parts.push(createElement('span', { key: `ansi-${segmentKey++}`, className: classNames }, chunk));
	};

	while ((match = re.exec(text)) !== null) {
		const idx = match.index;
		if (idx > lastIndex) pushText(text.slice(lastIndex, idx));

		const codesRaw = match[1] ?? '';
		const codes = codesRaw
			.split(';')
			.filter((c) => c.length > 0)
			.map((c) => Number(c))
			.filter((n) => Number.isFinite(n));

		// Empty code list means reset in many terminals.
		const effectiveCodes = codes.length === 0 ? [0] : codes;
		for (const code of effectiveCodes) {
			if (code === 0) {
				style = {};
				continue;
			}
			if (code === 1) {
				style.bold = true;
				continue;
			}
			if (code === 2) {
				style.dim = true;
				continue;
			}
			if (code === 4) {
				style.underline = true;
				continue;
			}
			if (code === 22) {
				style.bold = false;
				style.dim = false;
				continue;
			}
			if (code === 24) {
				style.underline = false;
				continue;
			}
			if (code === 39) {
				style.fgClass = undefined;
				continue;
			}
			if (code === 49) {
				style.bgClass = undefined;
				continue;
			}

			if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
				style.fgClass = ansiColorClass(code);
				continue;
			}
			if (code >= 40 && code <= 47) {
				style.bgClass = ansiBgClass(code);
				continue;
			}
			if (code >= 100 && code <= 107) {
				// Bright backgrounds - approximate
				style.bgClass = 'bg-white/10';
				continue;
			}
		}

		lastIndex = re.lastIndex;
	}

	if (lastIndex < text.length) pushText(text.slice(lastIndex));
	return parts.length === 1 ? parts[0] : parts;
}
