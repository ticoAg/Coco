import { useState } from 'react';
import { Copy, ChevronRight } from 'lucide-react';
import { Collapse } from '../ui/Collapse';
import { DiffCountBadge } from './DiffCountBadge';
import type { DiffReviewChange, ParsedDiff, ParsedDiffLine } from './types/diff';
import { formatDiffPath, fileChangeVerb } from './utils/diff';

interface FileChangeEntryCardProps {
	change: DiffReviewChange;
	isPending: boolean;
	defaultCollapsed: boolean;
}

export function FileChangeEntryCard({ change, isPending, defaultCollapsed }: FileChangeEntryCardProps) {
	const initialOpen = isPending ? true : !defaultCollapsed;
	const [open, setOpen] = useState(initialOpen);
	const verb = fileChangeVerb(change.kind, isPending);
	const label = formatDiffPath(change.path, change.movePath);
	const copyText = change.diff ? `${label}\n${change.diff}`.trim() : label;
	const hasDiff = change.parsed.lines.length > 0;

	return (
		<div className={['am-block max-w-full', open ? 'am-block-open' : ''].join(' ')}>
			<div
				className="am-shell-header am-row group text-left"
				onClick={() => setOpen((prev) => !prev)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setOpen((prev) => !prev);
					}
				}}
			>
				<div className="min-w-0 flex items-center gap-2 text-text-main/90">
					<span className="shrink-0 text-text-menuLabel">{verb}</span>
					<span className="truncate font-mono text-[12px]">{label}</span>
					<DiffCountBadge added={change.parsed.added} removed={change.parsed.removed} />
				</div>
				<div className="flex items-center gap-1">
					{copyText ? (
						<button
							type="button"
							className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
							title="Copy diff"
							onClick={(ev) => {
								ev.stopPropagation();
								void navigator.clipboard.writeText(copyText);
							}}
						>
							<Copy className="h-3 w-3" />
						</button>
					) : null}
					<button
						type="button"
						className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
						title={open ? 'Collapse' : 'Expand'}
						onClick={(ev) => {
							ev.stopPropagation();
							setOpen((prev) => !prev);
						}}
					>
						<ChevronRight className={['h-3 w-3 transition-transform duration-200', open ? 'rotate-90' : ''].join(' ')} />
					</button>
				</div>
			</div>
			<Collapse open={open} innerClassName="pt-0">
				<div className="am-shell min-w-0">
					<div className="am-shell-scroll am-scroll-fade min-w-0">
						{hasDiff ? (
							<SideBySideDiff parsed={change.parsed} />
						) : (
							<div className="text-[10px] italic text-text-muted">No diff content</div>
						)}
					</div>
				</div>
			</Collapse>
		</div>
	);
}

type SideBySideRow = {
	left: { lineNo?: number; text: string; kind: 'delete' | 'context' | 'empty' } | null;
	right: { lineNo?: number; text: string; kind: 'insert' | 'context' | 'empty' } | null;
	isEllipsis?: boolean;
};

function buildSideBySideRows(lines: ParsedDiffLine[]): SideBySideRow[] {
	const rows: SideBySideRow[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (line.kind === 'ellipsis') {
			rows.push({ left: null, right: null, isEllipsis: true });
			i++;
			continue;
		}

		if (line.kind === 'context') {
			rows.push({
				left: { lineNo: line.oldLine, text: line.text, kind: 'context' },
				right: { lineNo: line.newLine, text: line.text, kind: 'context' },
			});
			i++;
			continue;
		}

		// Collect consecutive deletes and inserts for pairing
		const deletes: ParsedDiffLine[] = [];
		const inserts: ParsedDiffLine[] = [];

		while (i < lines.length && lines[i].kind === 'delete') {
			deletes.push(lines[i]);
			i++;
		}
		while (i < lines.length && lines[i].kind === 'insert') {
			inserts.push(lines[i]);
			i++;
		}

		// Pair deletes with inserts side by side
		const maxLen = Math.max(deletes.length, inserts.length);
		for (let j = 0; j < maxLen; j++) {
			const del = deletes[j];
			const ins = inserts[j];
			rows.push({
				left: del ? { lineNo: del.oldLine, text: del.text, kind: 'delete' } : { text: '', kind: 'empty' },
				right: ins ? { lineNo: ins.newLine, text: ins.text, kind: 'insert' } : { text: '', kind: 'empty' },
			});
		}
	}

	return rows;
}

function SideBySideDiff({ parsed }: { parsed: ParsedDiff }) {
	if (!parsed.lines.length) return null;

	const gutterWidth = Math.max(parsed.lineNumberWidth, 1);
	const formatLineNumber = (value?: number) => (typeof value === 'number' ? String(value) : '');

	// Check if this is a pure add or pure delete (no mixed changes)
	const hasInsert = parsed.lines.some((l) => l.kind === 'insert');
	const hasDelete = parsed.lines.some((l) => l.kind === 'delete');
	const isPureAdd = hasInsert && !hasDelete;
	const isPureDelete = hasDelete && !hasInsert;

	// For pure add/delete, use single column view
	if (isPureAdd || isPureDelete) {
		return (
			<div className="font-mono text-[11px] leading-snug min-w-0">
				{parsed.lines.map((line, idx) => {
					if (line.kind === 'ellipsis') {
						return (
							<div key={`line-${idx}`} className="flex text-text-muted/40 px-1">
								<span className="text-right pr-1 shrink-0" style={{ width: `${gutterWidth}ch` }} />
								<span className="w-[2ch] shrink-0" />
								<span>⋮</span>
							</div>
						);
					}
					const lineNo = isPureAdd ? line.newLine : line.oldLine;
					const bgClass = line.kind === 'insert' ? 'bg-green-500/10' : line.kind === 'delete' ? 'bg-red-500/10' : '';
					const textClass = line.kind === 'insert' ? 'text-green-400' : line.kind === 'delete' ? 'text-red-400' : 'text-text-muted';
					const prefix = line.kind === 'insert' ? '+' : line.kind === 'delete' ? '-' : ' ';
					return (
						<div key={`line-${idx}`} className={`flex ${bgClass}`}>
							<span className="text-right text-text-muted/50 pr-1 shrink-0" style={{ width: `${gutterWidth}ch` }}>
								{formatLineNumber(lineNo)}
							</span>
							<span className={`w-[2ch] shrink-0 ${textClass}`}>{prefix}</span>
							<span className={`whitespace-pre-wrap break-words ${textClass}`}>{line.text}</span>
						</div>
					);
				})}
			</div>
		);
	}

	// For mixed changes, use side-by-side view
	const rows = buildSideBySideRows(parsed.lines);

	return (
		<div className="flex font-mono text-[11px] leading-snug min-w-0 overflow-hidden max-w-full">
			{/* Left side (old) */}
			<div className="flex-1 min-w-0 border-r border-white/5">
				<div className="overflow-x-auto h-full">
					{rows.map((row, idx) => {
					if (row.isEllipsis) {
						return (
							<div key={`left-${idx}`} className="flex text-text-muted/40 px-1">
								<span className="text-right pr-1 shrink-0" style={{ width: `${gutterWidth}ch` }} />
								<span>⋮</span>
							</div>
						);
					}
					const left = row.left;
					if (!left) return <div key={`left-${idx}`} className="h-[1.35em]" />;
					const bgClass = left.kind === 'delete' ? 'bg-red-500/10' : left.kind === 'empty' ? 'bg-white/[0.02]' : '';
					const textClass = left.kind === 'delete' ? 'text-red-400' : 'text-text-muted';
					return (
						<div key={`left-${idx}`} className={`flex ${bgClass}`}>
							<span className="text-right text-text-muted/50 pr-1 shrink-0" style={{ width: `${gutterWidth}ch` }}>
								{formatLineNumber(left.lineNo)}
							</span>
							<span className={`whitespace-pre-wrap break-words ${textClass}`}>{left.text}</span>
						</div>
					);
				})}
				</div>
			</div>
			{/* Right side (new) */}
			<div className="flex-1 min-w-0">
				<div className="overflow-x-auto h-full">
					{rows.map((row, idx) => {
					if (row.isEllipsis) {
						return (
							<div key={`right-${idx}`} className="flex text-text-muted/40 px-1">
								<span className="text-right pr-1 shrink-0" style={{ width: `${gutterWidth}ch` }} />
								<span>⋮</span>
							</div>
						);
					}
					const right = row.right;
					if (!right) return <div key={`right-${idx}`} className="h-[1.35em]" />;
					const bgClass = right.kind === 'insert' ? 'bg-green-500/10' : right.kind === 'empty' ? 'bg-white/[0.02]' : '';
					const textClass = right.kind === 'insert' ? 'text-green-400' : 'text-text-muted';
					return (
						<div key={`right-${idx}`} className={`flex ${bgClass}`}>
							<span className="text-right text-text-muted/50 pr-1 shrink-0" style={{ width: `${gutterWidth}ch` }}>
								{formatLineNumber(right.lineNo)}
							</span>
							<span className={`whitespace-pre-wrap break-words ${textClass}`}>{right.text}</span>
						</div>
					);
				})}
				</div>
			</div>
		</div>
	);
}
