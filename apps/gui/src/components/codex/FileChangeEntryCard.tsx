import { useState } from 'react';
import { Copy, ChevronRight } from 'lucide-react';
import { Collapse } from '../ui/Collapse';
import { DiffCountBadge } from './DiffCountBadge';
import type { DiffReviewChange, ParsedDiff } from './types/diff';
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
		<div className={['am-block', open ? 'am-block-open' : ''].join(' ')}>
			<div
				className="am-shell-header group"
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
				<div className="am-shell">
					<div className="am-shell-scroll am-scroll-fade">
						{hasDiff ? (
							<div className="space-y-0.5">{renderDiffLines(change.parsed)}</div>
						) : (
							<div className="text-[10px] italic text-text-muted">No diff content</div>
						)}
					</div>
				</div>
			</Collapse>
		</div>
	);
}

function renderDiffLines(parsed: ParsedDiff): React.ReactNode {
	if (!parsed.lines.length) return null;
	const gutterWidth = Math.max(parsed.lineNumberWidth, 1);
	const formatLineNumber = (value?: number) => (typeof value === 'number' ? String(value) : '');
	return (
		<div className="space-y-0.5">
			{parsed.lines.map((line, idx) => {
				if (line.kind === 'ellipsis') {
					return (
						<div
							key={`diff-ellipsis-${idx}`}
							className="grid w-full font-mono text-[11px] leading-snug text-text-muted/70"
							style={{ gridTemplateColumns: `${gutterWidth}ch 2ch 1fr` }}
						>
							<span className="text-right text-text-muted/40" />
							<span className="text-text-muted/40" />
							<span>⋮</span>
						</div>
					);
				}
				const lineNo = line.newLine ?? line.oldLine;
				const lineClass = line.kind === 'insert' ? 'text-green-400' : line.kind === 'delete' ? 'text-red-400' : 'text-text-muted';
				const rowClass = line.kind === 'insert' ? 'bg-green-500/5' : line.kind === 'delete' ? 'bg-red-500/5' : '';
				return (
					<div
						key={`diff-${idx}`}
						className={['grid w-full font-mono text-[11px] leading-snug', rowClass].filter(Boolean).join(' ')}
						style={{ gridTemplateColumns: `${gutterWidth}ch 2ch 1fr` }}
					>
						<span className="text-right text-text-muted/60">{formatLineNumber(lineNo)}</span>
						<span className={lineClass}>{line.kind === 'insert' ? '+' : line.kind === 'delete' ? '-' : ' '}</span>
						<span className={`${lineClass} whitespace-pre`}>{line.text}</span>
					</div>
				);
			})}
		</div>
	);
}
