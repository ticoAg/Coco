import type {
	SharedArtifactCategory,
	SharedArtifactContent,
	SharedArtifactSummary,
	SubagentFinalOutput,
	SubagentSessionSummary,
	TaskDirEntry,
	TaskTextFileContent,
} from '@/types/task';
import { TextPreview } from '@/shared/ui/TextPreview';
import { ARTIFACT_CATEGORIES, DEFAULT_SHARED_FILES, type WorkbenchNode, workbenchNodeKey } from '../../model/workbench';
import { formatEpochMs } from '../../lib/format';

interface WorkbenchTabProps {
	sessionAutoFollow: boolean;
	onToggleAutoFollow: (value: boolean) => void;
	onRefresh: () => void;
	workbenchArtifactsByCategory: Record<SharedArtifactCategory, SharedArtifactSummary[]>;
	workbenchArtifactsLoading: boolean;
	workbenchArtifactsError: string | null;
	workbenchEvidenceEntries: TaskDirEntry[];
	workbenchEvidenceLoading: boolean;
	workbenchEvidenceError: string | null;
	workbenchSelected: WorkbenchNode | null;
	workbenchSelectionKey: string | null;
	workbenchExpandedByKey: Record<string, boolean>;
	onToggleExpanded: (key: string) => void;
	onSelectNode: (node: WorkbenchNode) => void;
	workbenchPreviewError: string | null;
	workbenchPreviewLoading: boolean;
	workbenchTextFile: TaskTextFileContent | null;
	workbenchArtifactContent: SharedArtifactContent | null;
	sessions: SubagentSessionSummary[];
	sessionsLoading: boolean;
	finalOutput: SubagentFinalOutput | null;
	finalStatus: string | null;
	finalSummary: string | null;
	runtimeSearch: string;
	onRuntimeSearchChange: (value: string) => void;
	filteredRuntimeEvents: string[];
	filteredRuntimeStderr: string[];
}

export function WorkbenchTab({
	sessionAutoFollow,
	onToggleAutoFollow,
	onRefresh,
	workbenchArtifactsByCategory,
	workbenchArtifactsLoading,
	workbenchArtifactsError,
	workbenchEvidenceEntries,
	workbenchEvidenceLoading,
	workbenchEvidenceError,
	workbenchSelected,
	workbenchSelectionKey,
	workbenchExpandedByKey,
	onToggleExpanded,
	onSelectNode,
	workbenchPreviewError,
	workbenchPreviewLoading,
	workbenchTextFile,
	workbenchArtifactContent,
	sessions,
	sessionsLoading,
	finalOutput,
	finalStatus,
	finalSummary,
	runtimeSearch,
	onRuntimeSearchChange,
	filteredRuntimeEvents,
	filteredRuntimeStderr,
}: WorkbenchTabProps) {
	const expanded = (key: string) => Boolean(workbenchExpandedByKey[key]);
	const isSelected = (node: WorkbenchNode) => (workbenchSelectionKey ? workbenchNodeKey(node) === workbenchSelectionKey : false);
	const indentPx = (depth: number) => 8 + depth * 14;

	const TreeButton = ({ node, label, depth, meta }: { node: WorkbenchNode; label: string; depth: number; meta?: string | null }) => {
		const selected = isSelected(node);
		return (
			<button
				type="button"
				className={[
					'w-full rounded-md border px-2 py-1 text-left',
					selected ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:border-white/10 hover:bg-white/5',
				].join(' ')}
				style={{ paddingLeft: indentPx(depth) }}
				onClick={() => onSelectNode(node)}
				title={label}
			>
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<div className="truncate text-[12px] text-text-main">{label}</div>
						{meta ? <div className="mt-0.5 truncate text-[10px] text-text-dim">{meta}</div> : null}
					</div>
				</div>
			</button>
		);
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="text-sm font-semibold">Task Workbench</div>
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

			{workbenchArtifactsError ? (
				<div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{workbenchArtifactsError}</div>
			) : null}
			{workbenchEvidenceError ? (
				<div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{workbenchEvidenceError}</div>
			) : null}

			<div className="grid grid-cols-[320px_1fr] gap-4">
				<div className="min-h-0 space-y-2 overflow-auto rounded-lg border border-white/10 bg-bg-panelHover p-2">
					<div className="space-y-2">
						<button
							type="button"
							className="w-full rounded-md px-2 py-1 text-left text-xs font-semibold text-text-muted hover:bg-white/5"
							onClick={() => onToggleExpanded('shared')}
						>
							{expanded('shared') ? 'v' : '>'} shared/
							{workbenchArtifactsLoading || workbenchEvidenceLoading ? <span className="ml-2 text-[10px] text-text-dim">loading…</span> : null}
						</button>

						{expanded('shared') ? (
							<div className="space-y-1">
								{DEFAULT_SHARED_FILES.map((n) => (
									<TreeButton key={workbenchNodeKey(n)} node={n} label={n.label} depth={1} />
								))}

								{ARTIFACT_CATEGORIES.map((category) => (
									<div key={`cat-${category}`} className="space-y-1">
										<button
											type="button"
											className="w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-text-muted hover:bg-white/5"
											style={{ paddingLeft: indentPx(1) }}
											onClick={() => onToggleExpanded(category)}
										>
											{expanded(category) ? 'v' : '>'} {category}/
										</button>
										{expanded(category) ? (
											<div className="space-y-1">
												{workbenchArtifactsByCategory[category].length === 0 ? (
													<div className="px-2 py-1 text-[11px] text-text-dim" style={{ paddingLeft: indentPx(2) }}>
														(empty)
													</div>
												) : (
													workbenchArtifactsByCategory[category].map((item) => {
														const node: WorkbenchNode = {
															kind: 'sharedArtifact',
															category,
															path: item.path,
															label: item.filename,
														};
														return (
															<TreeButton
																key={`${category}:${item.path}`}
																node={node}
																label={item.filename}
																depth={2}
																meta={item.path !== item.filename ? item.path : undefined}
															/>
														);
													})
												)}
											</div>
										) : null}
									</div>
								))}

								<div className="space-y-1">
									<button
										type="button"
										className="w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-text-muted hover:bg-white/5"
										style={{ paddingLeft: indentPx(1) }}
										onClick={() => onToggleExpanded('evidence')}
									>
										{expanded('evidence') ? 'v' : '>'} evidence/
										{workbenchEvidenceLoading ? <span className="ml-2 text-[10px] text-text-dim">loading…</span> : null}
									</button>
									{expanded('evidence') ? (
										<div className="space-y-1">
											{workbenchEvidenceEntries.filter((entry) => entry.kind === 'file').length === 0 ? (
												<div className="px-2 py-1 text-[11px] text-text-dim" style={{ paddingLeft: indentPx(2) }}>
													(empty)
												</div>
											) : (
												workbenchEvidenceEntries
													.filter((entry) => entry.kind === 'file')
													.map((entry) => {
														const label = entry.path.replace(/^shared\/evidence\//, '');
														const node: WorkbenchNode = {
															kind: 'sharedFile',
															path: entry.path,
															label: label || entry.name,
														};
														return (
															<TreeButton
																key={`evidence:${entry.path}`}
																node={node}
																label={label || entry.name}
																depth={2}
																meta={entry.path !== label ? entry.path : undefined}
															/>
														);
													})
											)}
										</div>
									) : null}
								</div>
							</div>
						) : null}

						<button
							type="button"
							className="w-full rounded-md px-2 py-1 text-left text-xs font-semibold text-text-muted hover:bg-white/5"
							onClick={() => onToggleExpanded('agents')}
						>
							{expanded('agents') ? 'v' : '>'} agents/
							{sessionsLoading ? <span className="ml-2 text-[10px] text-text-dim">loading…</span> : null}
						</button>

						{expanded('agents') ? (
							<div className="space-y-1">
								{sessions.length === 0 ? (
									<div className="px-2 py-1 text-[11px] text-text-dim" style={{ paddingLeft: indentPx(1) }}>
										(no sessions)
									</div>
								) : (
									sessions.map((s) => {
										const agentKey = `agent:${s.agentInstance}`;
										const badge = {
											running: 'bg-status-info/15 text-status-info',
											completed: 'bg-status-success/15 text-status-success',
											failed: 'bg-status-error/15 text-status-error',
											blocked: 'bg-status-warning/15 text-status-warning',
											unknown: 'bg-white/10 text-text-muted',
										}[s.status];

										return (
											<div key={agentKey} className="space-y-1">
												<button
													type="button"
													className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-white/5"
													style={{ paddingLeft: indentPx(1) }}
													onClick={() => onToggleExpanded(agentKey)}
												>
													<div className="min-w-0">
														<div className="truncate text-[12px] font-semibold text-text-main">{s.agentInstance}</div>
														<div className="mt-0.5 text-[10px] text-text-dim">updated: {formatEpochMs(s.lastUpdatedAtMs)}</div>
													</div>
													<span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge}`}>{s.status}</span>
												</button>

												{expanded(agentKey) ? (
													<div className="space-y-1">
														<TreeButton node={{ kind: 'agent', agentInstance: s.agentInstance, section: 'session' }} label="session.json" depth={2} />

														<div
															className="w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-text-muted"
															style={{ paddingLeft: indentPx(2) }}
														>
															runtime/
														</div>
														<TreeButton node={{ kind: 'agent', agentInstance: s.agentInstance, section: 'events' }} label="events.jsonl" depth={3} />
														<TreeButton node={{ kind: 'agent', agentInstance: s.agentInstance, section: 'stderr' }} label="stderr.log" depth={3} />

														<div
															className="w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-text-muted"
															style={{ paddingLeft: indentPx(2) }}
														>
															artifacts/
														</div>
														<TreeButton node={{ kind: 'agent', agentInstance: s.agentInstance, section: 'final' }} label="final.json" depth={3} />
													</div>
												) : null}
											</div>
										);
									})
								)}
							</div>
						) : null}
					</div>
				</div>

				<div className="min-w-0 space-y-4">
					{workbenchPreviewError ? (
						<div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{workbenchPreviewError}</div>
					) : null}

					{(() => {
						if (!workbenchSelected) {
							return (
								<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">Select a node to preview.</div>
							);
						}

						if (workbenchSelected.kind === 'agent') {
							const title = `${workbenchSelected.agentInstance} • ${workbenchSelected.section}`;
							if (workbenchSelected.section === 'final') {
								return (
									<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
										<div className="flex items-center justify-between gap-2">
											<div className="truncate text-sm font-semibold">{title}</div>
											<div className="text-xs text-text-muted">auto-refresh: 2s</div>
										</div>
										<div className="mt-3">
											{!finalOutput ? (
												<div className="text-sm text-text-muted">Loading…</div>
											) : !finalOutput.exists ? (
												<div className="text-sm text-text-muted">`artifacts/final.json` not found yet.</div>
											) : finalOutput.parseError ? (
												<div className="text-sm text-status-warning">{finalOutput.parseError}</div>
											) : finalOutput.json ? (
												<pre className="max-h-[520px] overflow-auto rounded-md bg-black/20 p-3 text-xs text-text-muted">
													{JSON.stringify(finalOutput.json, null, 2)}
												</pre>
											) : (
												<div className="text-sm text-text-muted">No structured output.</div>
											)}
										</div>
										{finalStatus ? (
											<div className="mt-3 text-xs text-text-muted">
												final.status: <span className="font-mono">{finalStatus}</span>
											</div>
										) : null}
										{finalSummary ? <div className="mt-2 text-sm text-text-muted">{finalSummary}</div> : null}
									</div>
								);
							}

							if (workbenchSelected.section === 'events' || workbenchSelected.section === 'stderr') {
								const lines = workbenchSelected.section === 'events' ? filteredRuntimeEvents : filteredRuntimeStderr;
								return (
									<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
										<div className="flex flex-wrap items-center justify-between gap-3">
											<div className="truncate text-sm font-semibold">{title}</div>
											<input
												type="text"
												value={runtimeSearch}
												onChange={(e) => onRuntimeSearchChange(e.target.value)}
												placeholder="Search…"
												className="w-[220px] rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-text-main placeholder:text-text-dim"
											/>
										</div>
										<div className="mt-3">
											{lines.length === 0 ? (
												<div className="text-sm text-text-muted">(empty)</div>
											) : (
												<pre className="max-h-[560px] overflow-auto rounded-md bg-black/20 p-3 text-[11px] text-text-muted">{lines.join('\n')}</pre>
											)}
										</div>
									</div>
								);
							}

							const content = workbenchTextFile?.content ?? null;
							return (
								<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
									<div className="flex items-center justify-between gap-2">
										<div className="truncate text-sm font-semibold">{title}</div>
										<div className="text-xs text-text-muted">{workbenchPreviewLoading ? 'Loading…' : ''}</div>
									</div>
									<div className="mt-3">
										{!workbenchTextFile ? (
											<div className="text-sm text-text-muted">Loading…</div>
										) : !workbenchTextFile.exists ? (
											<div className="text-sm text-text-muted">File not found yet.</div>
										) : !content ? (
											<div className="text-sm text-text-muted">(empty)</div>
										) : (
											<TextPreview content={content} path={workbenchTextFile?.path ?? 'session.json'} />
										)}
									</div>
									{workbenchTextFile?.updatedAtMs ? (
										<div className="mt-2 text-xs text-text-muted">updated: {formatEpochMs(workbenchTextFile.updatedAtMs)}</div>
									) : null}
									{workbenchTextFile?.truncated ? <div className="mt-2 text-xs text-status-warning">truncated</div> : null}
								</div>
							);
						}

						if (workbenchSelected.kind === 'sharedArtifact') {
							const previewPath = workbenchSelected.path;
							return (
								<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
									<div className="flex items-center justify-between gap-2">
										<div className="truncate text-sm font-semibold">{`${workbenchSelected.category}/${workbenchSelected.path}`}</div>
										<div className="text-xs text-text-muted">{workbenchPreviewLoading ? 'Loading…' : ''}</div>
									</div>
									<div className="mt-3">
										{!workbenchArtifactContent ? (
											<div className="text-sm text-text-muted">Loading…</div>
										) : (
											<TextPreview content={workbenchArtifactContent.content} path={previewPath} />
										)}
									</div>
									{workbenchArtifactContent?.updatedAtMs ? (
										<div className="mt-2 text-xs text-text-muted">updated: {formatEpochMs(workbenchArtifactContent.updatedAtMs)}</div>
									) : null}
								</div>
							);
						}

						const content = workbenchTextFile?.content ?? null;
						return (
							<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
								<div className="flex items-center justify-between gap-2">
									<div className="truncate text-sm font-semibold">{workbenchSelected.path}</div>
									<div className="text-xs text-text-muted">{workbenchPreviewLoading ? 'Loading…' : ''}</div>
								</div>
								<div className="mt-3">
									{!workbenchTextFile ? (
										<div className="text-sm text-text-muted">Loading…</div>
									) : !workbenchTextFile.exists ? (
										<div className="text-sm text-text-muted">File not found yet.</div>
									) : !content ? (
										<div className="text-sm text-text-muted">(empty)</div>
									) : (
										<TextPreview content={content} path={workbenchSelected.path} />
									)}
								</div>
								{workbenchTextFile?.updatedAtMs ? (
									<div className="mt-2 text-xs text-text-muted">updated: {formatEpochMs(workbenchTextFile.updatedAtMs)}</div>
								) : null}
								{workbenchTextFile?.truncated ? <div className="mt-2 text-xs text-status-warning">truncated</div> : null}
							</div>
						);
					})()}
				</div>
			</div>
		</div>
	);
}

export default WorkbenchTab;
