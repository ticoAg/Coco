import type { CodexThreadSummary } from '../../types/codex';
import { SessionRunningIndicator } from './SessionRunningIndicator';

interface SessionSidebarProps {
	isOpen: boolean;
	sessions: CodexThreadSummary[];
	loading: boolean;
	error: string | null;
	selectedThreadId: string | null;
	runningThreadIds: Record<string, boolean>;
	onRefresh: () => void | Promise<void>;
	onClose: () => void;
	onSelect: (threadId: string) => void | Promise<void>;
}

function formatSessionUpdatedAtMs(session: CodexThreadSummary): string {
	const updated = session.updatedAtMs ? new Date(session.updatedAtMs).toLocaleString() : '—';
	return updated;
}

export function SessionSidebar({ isOpen, sessions, loading, error, selectedThreadId, runningThreadIds, onRefresh, onClose, onSelect }: SessionSidebarProps) {
	if (!isOpen) return null;

	return (
			<div className="fixed inset-0 z-50 flex">
				<div className="flex-1 bg-black/60" onClick={onClose} role="button" tabIndex={0} />
				<div className="w-[420px] max-w-[92vw] border-l border-white/10 bg-bg-popover p-6">
				<div className="mb-4 flex items-start justify-between gap-3">
					<div>
						<div className="text-sm font-semibold">Sessions</div>
						<div className="mt-1 text-xs text-text-muted">Sorted by recently updated.</div>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20"
							onClick={() => void onRefresh()}
						>
							Refresh
						</button>
						<button type="button" className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20" onClick={onClose}>
							Close
						</button>
					</div>
				</div>

				{error ? <div className="mb-3 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{error}</div> : null}

				<div className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-bg-popover p-2">
					{loading ? (
						<div className="p-3 text-sm text-text-muted">Loading sessions…</div>
					) : sessions.length === 0 ? (
						<div className="p-3 text-sm text-text-muted">No sessions yet.</div>
					) : (
						<div className="space-y-2">
							{sessions.map((s) => {
								const isSelected = s.id === selectedThreadId;
								const isRunning = Boolean(runningThreadIds[s.id]);
								return (
									<button
										key={s.id}
										type="button"
										className={[
											'w-full rounded-xl border px-3 py-2 text-left transition',
											isSelected ? 'border-primary/40 bg-primary/10' : 'border-white/10 bg-bg-panelHover hover:border-white/20',
										].join(' ')}
										onClick={() => void onSelect(s.id)}
									>
										<div className="truncate text-sm font-semibold">{s.preview || '—'}</div>

										<div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-dim">
											<span className="truncate">{s.modelProvider}</span>
											<span className="flex shrink-0 items-center gap-1.5">
												{isRunning ? <SessionRunningIndicator /> : null}
												<span>{formatSessionUpdatedAtMs(s)}</span>
											</span>
										</div>
									</button>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
