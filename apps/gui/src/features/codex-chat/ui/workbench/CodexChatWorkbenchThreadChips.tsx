type WorkbenchGraph = {
	rootThreadId: string | null;
	orchestratorThreadId: string | null;
	workerThreadIds: string[];
};

type Props = {
	enabled: boolean;
	workbenchGraph: WorkbenchGraph;
	selectedThreadId: string | null;
	selectSession: (threadId: string, options?: { setAsWorkbenchRoot?: boolean }) => Promise<void>;
};

export function CodexChatWorkbenchThreadChips({ enabled, workbenchGraph, selectedThreadId, selectSession }: Props) {
	if (!enabled) return null;
	if (!workbenchGraph.orchestratorThreadId && workbenchGraph.workerThreadIds.length === 0) return null;

	return (
		<div className="mb-2 flex flex-wrap items-center gap-2">
			<button
				type="button"
				className={[
					'rounded-full border px-2 py-1 text-[11px] leading-none transition-colors',
					selectedThreadId === workbenchGraph.rootThreadId
						? 'border-primary/50 bg-primary/10 text-text-main'
						: 'border-white/10 bg-white/5 text-text-muted hover:bg-white/10',
				].join(' ')}
				onClick={() => {
					const root = workbenchGraph.rootThreadId;
					if (root) void selectSession(root, { setAsWorkbenchRoot: true });
				}}
			>
				Root
			</button>

			{workbenchGraph.orchestratorThreadId ? (
				<button
					type="button"
					className={[
						'rounded-full border px-2 py-1 text-[11px] leading-none transition-colors',
						selectedThreadId === workbenchGraph.orchestratorThreadId
							? 'border-primary/50 bg-primary/10 text-text-main'
							: 'border-white/10 bg-white/5 text-text-muted hover:bg-white/10',
					].join(' ')}
					onClick={() => void selectSession(workbenchGraph.orchestratorThreadId!)}
					title={workbenchGraph.orchestratorThreadId}
				>
					Orchestrator
				</button>
			) : null}

			{workbenchGraph.workerThreadIds.map((id) => (
				<button
					key={id}
					type="button"
					className={[
						'rounded-full border px-2 py-1 text-[11px] leading-none transition-colors',
						selectedThreadId === id ? 'border-primary/50 bg-primary/10 text-text-main' : 'border-white/10 bg-white/5 text-text-muted hover:bg-white/10',
					].join(' ')}
					onClick={() => void selectSession(id)}
					title={id}
				>
					Worker
				</button>
			))}
		</div>
	);
}
