import type { SubagentFinalOutput, SubagentSessionSummary } from '@/types/task';
import { formatEpochMs } from '../../lib/format';

interface SessionsTabProps {
	sessions: SubagentSessionSummary[];
	sessionsLoading: boolean;
	sessionsError: string | null;
	selectedAgentInstance: string | null;
	finalStatus: string | null;
	finalSummary: string | null;
	finalOutput: SubagentFinalOutput | null;
	runtimeSearch: string;
	onRuntimeSearchChange: (value: string) => void;
	filteredRuntimeEvents: string[];
	filteredRuntimeStderr: string[];
	sessionAutoFollow: boolean;
	onToggleAutoFollow: (value: boolean) => void;
	onRefresh: () => void;
	onSelectAgentInstance: (agentInstance: string) => void;
}

export function SessionsTab({
	sessions,
	sessionsLoading,
	sessionsError,
	selectedAgentInstance,
	finalStatus,
	finalSummary,
	finalOutput,
	runtimeSearch,
	onRuntimeSearchChange,
	filteredRuntimeEvents,
	filteredRuntimeStderr,
	sessionAutoFollow,
	onToggleAutoFollow,
	onRefresh,
	onSelectAgentInstance,
}: SessionsTabProps) {
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="text-sm font-semibold">Subagents / Sessions</div>
				<div className="flex items-center gap-3">
					<label className="flex items-center gap-2 text-xs text-text-muted">
						<input type="checkbox" checked={sessionAutoFollow} onChange={(e) => onToggleAutoFollow(e.target.checked)} />
						<span>Auto-follow</span>
					</label>
					<button type="button" className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-sm hover:border-white/20" onClick={onRefresh}>
						Refresh
					</button>
				</div>
			</div>

			{sessionsError ? <div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{sessionsError}</div> : null}

			{sessionsLoading && sessions.length === 0 ? (
				<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">Loading sessions…</div>
			) : sessions.length === 0 ? (
				<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">No subagent sessions yet.</div>
			) : (
				<div className="grid grid-cols-[320px_1fr] gap-4">
					<div className="space-y-2">
						{sessions.map((s) => {
							const badge = {
								running: 'bg-status-info/15 text-status-info',
								completed: 'bg-status-success/15 text-status-success',
								failed: 'bg-status-error/15 text-status-error',
								blocked: 'bg-status-warning/15 text-status-warning',
								unknown: 'bg-white/10 text-text-muted',
							}[s.status];

							const isSelected = s.agentInstance === selectedAgentInstance;

							return (
								<button
									key={s.agentInstance}
									type="button"
									className={[
										'w-full rounded-lg border px-3 py-2 text-left',
										isSelected ? 'border-primary/40 bg-primary/10' : 'border-white/10 bg-bg-panelHover hover:border-white/20',
									].join(' ')}
									onClick={() => onSelectAgentInstance(s.agentInstance)}
								>
									<div className="flex items-center justify-between gap-2">
										<div className="truncate text-sm font-semibold">{s.agentInstance}</div>
										<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{s.status}</span>
									</div>
									<div className="mt-1 text-xs text-text-muted">updated: {formatEpochMs(s.lastUpdatedAtMs)}</div>
								</button>
							);
						})}
					</div>

					<div className="min-w-0 space-y-4">
						{selectedAgentInstance ? (
							<>
								<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
									<div className="flex items-center justify-between gap-2">
										<div className="text-sm font-semibold">{selectedAgentInstance}</div>
										<div className="text-xs text-text-muted">auto-refresh: 2s</div>
									</div>
									{finalStatus ? (
										<div className="mt-2 text-xs text-text-muted">
											final.status: <span className="font-mono">{finalStatus}</span>
										</div>
									) : null}
									{finalSummary ? <div className="mt-2 text-sm text-text-muted">{finalSummary}</div> : null}
								</div>

								<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
									<div className="mb-2 text-sm font-semibold">Final Output</div>
									{!finalOutput ? (
										<div className="text-sm text-text-muted">Loading…</div>
									) : !finalOutput.exists ? (
										<div className="text-sm text-text-muted">`artifacts/final.json` not found yet.</div>
									) : finalOutput.parseError ? (
										<div className="text-sm text-status-warning">{finalOutput.parseError}</div>
									) : finalOutput.json ? (
										<pre className="max-h-[260px] overflow-auto rounded-md bg-black/20 p-3 text-xs text-text-muted">
											{JSON.stringify(finalOutput.json, null, 2)}
										</pre>
									) : (
										<div className="text-sm text-text-muted">No structured output.</div>
									)}
								</div>

								<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div className="text-sm font-semibold">Runtime Logs (tail)</div>
										<input
											type="text"
											value={runtimeSearch}
											onChange={(e) => onRuntimeSearchChange(e.target.value)}
											placeholder="Search…"
											className="w-[220px] rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-text-main placeholder:text-text-dim"
										/>
									</div>

									<div className="mt-3 space-y-3">
										<div>
											<div className="mb-2 text-xs font-semibold text-text-muted">events.jsonl</div>
											{filteredRuntimeEvents.length === 0 ? (
												<div className="text-sm text-text-muted">No runtime events yet.</div>
											) : (
												<pre className="max-h-[200px] overflow-auto rounded-md bg-black/20 p-3 text-[11px] text-text-muted">
													{filteredRuntimeEvents.join('\n')}
												</pre>
											)}
										</div>

										<div>
											<div className="mb-2 text-xs font-semibold text-text-muted">stderr.log</div>
											{filteredRuntimeStderr.length === 0 ? (
												<div className="text-sm text-text-muted">No stderr output yet.</div>
											) : (
												<pre className="max-h-[200px] overflow-auto rounded-md bg-black/20 p-3 text-[11px] text-text-muted">
													{filteredRuntimeStderr.join('\n')}
												</pre>
											)}
										</div>
									</div>
								</div>
							</>
						) : (
							<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">
								Select a session to view details.
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export default SessionsTab;
