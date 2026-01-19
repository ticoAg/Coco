import { useMemo } from 'react';
import type { TaskEvent } from '@/types/task';
import { formatDate } from '../../lib/format';

function EventItem({ event }: { event: TaskEvent }) {
	const payloadMessage = useMemo(() => {
		if (!event.payload || typeof event.payload !== 'object') return null;
		const p = event.payload as Record<string, unknown>;
		if (typeof p.message === 'string') return p.message;
		return null;
	}, [event.payload]);

	return (
		<div className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
			<div className="text-xs text-text-dim">{formatDate(event.ts)}</div>
			<div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
				<span className="font-mono text-xs text-accent">[{event.type}]</span>
				{event.agentInstance ? <span className="text-xs text-text-muted">@{event.agentInstance}</span> : null}
				{payloadMessage ? <span className="text-text-muted">{payloadMessage}</span> : null}
			</div>
		</div>
	);
}

interface EventsTabProps {
	events: TaskEvent[];
	hasMoreEvents: boolean;
	onLoadMoreEvents: () => void;
}

export function EventsTab({ events, hasMoreEvents, onLoadMoreEvents }: EventsTabProps) {
	return (
		<div>
			{events.length === 0 ? (
				<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">No events yet.</div>
			) : (
				<div className="space-y-3">
					{events.map((e, idx) => (
						<EventItem key={`${e.ts}-${idx}`} event={e} />
					))}
				</div>
			)}
			{hasMoreEvents ? (
				<div className="mt-4 flex justify-center">
					<button
						type="button"
						className="rounded-md border border-white/10 bg-bg-panelHover px-4 py-2 text-sm hover:border-white/20"
						onClick={onLoadMoreEvents}
					>
						Load more
					</button>
				</div>
			) : null}
		</div>
	);
}

export default EventsTab;
