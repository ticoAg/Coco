import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Collapse } from '@/components/ui/Collapse';
import { countExplorationCounts, formatExplorationCounts, isReadingGroup, isReasoningGroup } from '../../lib/turn/exploration';
import type { ChatEntry, WorkingItem } from '../../codex/types';

export function ExplorationAccordion({
	status,
	items,
	renderItem,
}: {
	status: 'exploring' | 'explored';
	items: WorkingItem[];
	renderItem: (item: WorkingItem) => JSX.Element | null;
}) {
	const exploring = status === 'exploring';
	const [expanded, setExpanded] = useState(false);
	const open = expanded || exploring;

	const itemCount = useMemo(() => {
		// `mergeReadingEntries` can turn multiple reads into a single `readingGroup`,
		// but the VSCode plugin's accordion logic treats each underlying action as a row.
		// We use this for parity in "hide counts when only one item" + auto-scroll triggers.
		let count = 0;
		for (const item of items) {
			if (isReadingGroup(item)) {
				count += item.entries.length;
				continue;
			}
			if (isReasoningGroup(item)) {
				count += item.entries.length;
				continue;
			}
			count += 1;
		}
		return count;
	}, [items]);

	const countsText = useMemo(() => {
		// Plugin parity: hide counts when there's only one item and still exploring.
		if (exploring && itemCount === 1) return '';
		return formatExplorationCounts(countExplorationCounts(items));
	}, [exploring, itemCount, items]);

	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [itemCount, open]);

	const requestExpand = useCallback(() => {
		if (!expanded) setExpanded(true);
	}, [expanded]);

	// Plugin parity: if there's only one exploration item and we're not exploring, show it directly (no accordion header).
	if (itemCount === 1 && items.length === 1 && !exploring) {
		return renderItem(items[0]);
	}

	const prefix = exploring ? 'Exploring' : 'Explored';

	return (
		<div className={['am-block min-w-0 max-w-full', open ? 'am-block-open' : ''].join(' ')}>
			<div
				className="am-row group flex items-center gap-1.5 cursor-pointer select-none text-left"
				onClick={() => setExpanded((v) => !v)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key !== 'Enter' && e.key !== ' ') return;
					e.preventDefault();
					setExpanded((v) => !v);
				}}
			>
				<span className="min-w-0 flex-1 truncate text-[11px] text-text-main/80">
					<span className="font-medium">{prefix}</span>
					{countsText ? <span className="ml-1 text-text-muted">{countsText}</span> : null}
				</span>
				<ChevronDown
					className={[
						'h-3.5 w-3.5 shrink-0 transition-transform duration-200 text-text-muted',
						expanded ? 'rotate-180' : '',
						open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
					].join(' ')}
				/>
			</div>

			<Collapse open={open} innerClassName="pt-0">
				<div className="am-shell min-w-0">
					<div className="relative">
						<div
							ref={scrollRef}
							className={[
								'am-shell-scroll am-scroll-fade min-w-0',
								'flex flex-col overflow-y-auto overflow-x-hidden',
								// Limit to roughly "10 rows" worth of items
								'max-h-72',
							].join(' ')}
						>
							{items.map((item) => {
								const key = isReadingGroup(item) ? item.id : (item as ChatEntry).id;
								return (
									<div key={key} className="first:pt-0 last:mb-0 mb-0.5 [&>*]:py-0 min-w-0" onMouseDown={requestExpand} onFocusCapture={requestExpand}>
										{renderItem(item)}
									</div>
								);
							})}
						</div>
					</div>
				</div>
			</Collapse>
		</div>
	);
}
