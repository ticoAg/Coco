import { SessionRunningIndicator } from '../../codex/SessionRunningIndicator';

type WorkbenchGraph = {
	rootThreadId: string | null;
	orchestratorThreadId: string | null;
	workerThreadIds: string[];
	childrenByParent: Record<string, Array<{ threadId: string; kind: 'spawn' | 'fork'; seq: number }>>;
};

type CollabAgentState = { status: string; message: string | null; seq: number };

type Props = {
	enabled: boolean;
	workbenchGraph: WorkbenchGraph;
	workbenchAutoFocus: boolean;
	setWorkbenchAutoFocus: (value: boolean) => void;
	collabAgentStateByThreadId: Record<string, CollabAgentState>;
	runningThreadIds: Record<string, boolean>;
	selectSession: (threadId: string, options?: { setAsWorkbenchRoot?: boolean }) => Promise<void>;
	forkThreadLatest: (threadId: string) => Promise<void>;
};

export function CodexChatWorkbenchSidebar({
	enabled,
	workbenchGraph,
	workbenchAutoFocus,
	setWorkbenchAutoFocus,
	collabAgentStateByThreadId,
	runningThreadIds,
	selectSession,
	forkThreadLatest,
}: Props) {
	if (!enabled) return null;

	return (
		<div className="w-[280px] shrink-0 min-h-0 overflow-hidden rounded-xl border border-white/10 bg-bg-panelHover/40">
			<div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
				<div className="min-w-0">
					<div className="text-xs font-semibold">Collab Workbench</div>
					<div className="mt-0.5 truncate text-[10px] text-text-muted">
						{workbenchGraph.rootThreadId ? `root: ${workbenchGraph.rootThreadId}` : 'root: (none)'}
					</div>
				</div>
				<label className="flex items-center gap-1 text-[10px] text-text-muted">
					<input type="checkbox" checked={workbenchAutoFocus} onChange={(e) => setWorkbenchAutoFocus(e.target.checked)} />
					<span>Auto-focus</span>
				</label>
			</div>

			<div className="min-h-0 overflow-y-auto px-2 py-2">
				{(() => {
					const visited = new Set<string>();
					const roleFor = (threadId: string): 'root' | 'orchestrator' | 'worker' | 'thread' => {
						if (threadId === workbenchGraph.rootThreadId) return 'root';
						if (threadId === workbenchGraph.orchestratorThreadId) return 'orchestrator';
						if (workbenchGraph.workerThreadIds.includes(threadId)) return 'worker';
						return 'thread';
					};
					const statusFor = (threadId: string): string | null => {
						const st = collabAgentStateByThreadId[threadId];
						return st?.status ? st.status : null;
					};
					const renderNode = (threadId: string, depth: number): JSX.Element | null => {
						if (!threadId) return null;
						if (visited.has(threadId)) return null;
						visited.add(threadId);

						const role = roleFor(threadId);
						const running = Boolean(runningThreadIds[threadId]);
						const status = statusFor(threadId);
						const indentPx = 8 + depth * 12;

						const children = workbenchGraph.childrenByParent[threadId] ?? [];

						return (
							<div key={threadId}>
								<div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-white/5">
									<button
										type="button"
										className="min-w-0 flex-1 text-left"
										style={{ paddingLeft: indentPx }}
										onClick={() => void selectSession(threadId)}
										title={threadId}
									>
										<div className="flex items-center gap-2">
											{running ? <SessionRunningIndicator /> : null}
											<div className="truncate text-[11px] text-text-main">{threadId}</div>
										</div>
										<div className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted">
											<span className="rounded bg-white/10 px-1 py-0.5">{role}</span>
											{status ? <span className="rounded bg-white/10 px-1 py-0.5">{status}</span> : null}
										</div>
									</button>
									<button
										type="button"
										className="shrink-0 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-text-muted hover:border-white/20"
										onClick={() => void forkThreadLatest(threadId)}
										title="Fork this thread"
									>
										Fork
									</button>
								</div>

								{children.length > 0 ? (
									<div>
										{children.map((c) => (
											<div key={`${threadId}-${c.kind}-${c.threadId}`}>{renderNode(c.threadId, depth + 1)}</div>
										))}
									</div>
								) : null}
							</div>
						);
					};

					if (!workbenchGraph.rootThreadId) {
						return <div className="px-2 py-2 text-[11px] text-text-muted">No collab graph yet. Start a multi-agent task to see threads.</div>;
					}
					return <div className="space-y-1">{renderNode(workbenchGraph.rootThreadId, 0)}</div>;
				})()}
			</div>
		</div>
	);
}

