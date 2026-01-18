import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { apiClient } from '../api/client';
import type {
	AgentInstance,
	Gate,
	Milestone,
	SharedArtifactCategory,
	SharedArtifactContent,
	SharedArtifactSummary,
	Task,
	TaskEvent,
	TaskDirEntry,
	TaskTextFileContent,
} from '../types/task';
import { useSharedArtifacts, useSubagentSessions } from '../hooks/useTasks';
import { StatusBadge } from './TaskList';

type TabId = 'overview' | 'workbench' | 'events' | 'artifacts' | 'sessions';
const TABS: Array<{ id: TabId; label: string }> = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'workbench', label: 'Workbench' },
	{ id: 'events', label: 'Events' },
	{ id: 'artifacts', label: 'Artifacts' },
	{ id: 'sessions', label: 'Sessions' },
];
const ARTIFACT_CATEGORIES: SharedArtifactCategory[] = ['reports', 'contracts', 'decisions'];

type WorkbenchNode =
	| { kind: 'sharedFile'; path: string; label: string }
	| { kind: 'sharedArtifact'; category: SharedArtifactCategory; path: string; label: string }
	| { kind: 'agent'; agentInstance: string; section: 'session' | 'final' | 'events' | 'stderr' };

function workbenchNodeKey(node: WorkbenchNode): string {
	switch (node.kind) {
		case 'sharedFile':
			return `sharedFile:${node.path}`;
		case 'sharedArtifact':
			return `sharedArtifact:${node.category}:${node.path}`;
		case 'agent':
			return `agent:${node.agentInstance}:${node.section}`;
	}
}

const isMarkdownFile = (path?: string | null) => Boolean(path && path.toLowerCase().endsWith('.md'));
const isHtmlFile = (path?: string | null) => {
	if (!path) return false;
	const lower = path.toLowerCase();
	return lower.endsWith('.html') || lower.endsWith('.htm');
};

function renderTextPreview(content: string, path: string): ReactNode {
	if (isMarkdownFile(path)) {
		return (
			<div className="space-y-3 text-sm text-text-main">
				<ReactMarkdown>{content}</ReactMarkdown>
			</div>
		);
	}
	if (isHtmlFile(path)) {
		return <iframe title="HTML preview" sandbox="" className="h-[560px] w-full rounded-md border border-white/10 bg-black/20" srcDoc={content} />;
	}
	return <pre className="max-h-[560px] overflow-auto rounded-md bg-black/20 p-3 text-xs text-text-muted">{content}</pre>;
}

function formatDate(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleString();
}

function formatEpochMs(value: number | null): string {
	if (value == null) return '—';
	return new Date(value).toLocaleString();
}

function MilestoneItem({ milestone }: { milestone: Milestone }) {
	const icon = {
		pending: '○',
		working: '◐',
		done: '●',
		blocked: '⚠',
	}[milestone.state];

	const color = {
		pending: 'text-text-muted',
		working: 'text-status-info',
		done: 'text-status-success',
		blocked: 'text-status-warning',
	}[milestone.state];

	return (
		<div className="flex items-start gap-3 rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
			<div className={`mt-[2px] font-mono ${color}`}>{icon}</div>
			<div className="min-w-0">
				<div className="text-sm font-medium">{milestone.title}</div>
				<div className="mt-1 text-xs text-text-muted">
					{milestone.state}
					{milestone.dependsOn?.length ? ` • deps: ${milestone.dependsOn.join(', ')}` : ''}
				</div>
			</div>
		</div>
	);
}

function AgentCard({ agent }: { agent: AgentInstance }) {
	const color = {
		pending: 'text-text-muted',
		active: 'text-status-info',
		awaiting: 'text-text-muted',
		dormant: 'text-text-dim',
		completed: 'text-status-success',
		failed: 'text-status-error',
	}[agent.state];

	return (
		<div className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<div className="truncate text-sm font-semibold">{agent.instance}</div>
				<div className={`text-xs font-medium ${color}`}>{agent.state}</div>
			</div>
			<div className="mt-1 text-xs text-text-muted">{agent.agent}</div>
			{agent.skills?.length ? (
				<div className="mt-2 flex flex-wrap gap-1">
					{agent.skills.map((s) => (
						<span key={s} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-text-muted">
							{s}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

function GateItem({ gate }: { gate: Gate }) {
	const badge = {
		open: 'bg-white/10 text-text-muted',
		blocked: 'bg-status-warning/15 text-status-warning',
		approved: 'bg-status-success/15 text-status-success',
		rejected: 'bg-status-error/15 text-status-error',
	}[gate.state];

	return (
		<div className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<div className="text-xs uppercase tracking-wide text-text-muted">{gate.type}</div>
				<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{gate.state}</span>
			</div>
			{gate.reason ? <div className="mt-2 text-sm">{gate.reason}</div> : null}
			<div className="mt-2 text-xs text-text-muted">{gate.instructionsRef ? `instructions: ${gate.instructionsRef}` : null}</div>
		</div>
	);
}

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

interface TaskDetailProps {
	task: Task | null;
	events: TaskEvent[];
	loading: boolean;
	error: string | null;
	hasMoreEvents: boolean;
	onLoadMoreEvents: () => void;
	onClose: () => void;
}

export function TaskDetail({ task, events, loading, error, hasMoreEvents, onLoadMoreEvents, onClose }: TaskDetailProps) {
	const [tab, setTab] = useState<TabId>('overview');
	const [artifactCategory, setArtifactCategory] = useState<SharedArtifactCategory>('reports');
	const [sessionAutoFollow, setSessionAutoFollow] = useState(true);
	const [workbenchSelected, setWorkbenchSelected] = useState<WorkbenchNode | null>(null);
	const [workbenchExpandedByKey, setWorkbenchExpandedByKey] = useState<Record<string, boolean>>({
		shared: true,
		agents: true,
		reports: true,
		evidence: false,
		contracts: false,
		decisions: false,
	});
	const [workbenchArtifactsByCategory, setWorkbenchArtifactsByCategory] = useState<Record<SharedArtifactCategory, SharedArtifactSummary[]>>({
		reports: [],
		contracts: [],
		decisions: [],
	});
	const [workbenchArtifactsLoading, setWorkbenchArtifactsLoading] = useState(false);
	const [workbenchArtifactsError, setWorkbenchArtifactsError] = useState<string | null>(null);
	const [workbenchEvidenceEntries, setWorkbenchEvidenceEntries] = useState<TaskDirEntry[]>([]);
	const [workbenchEvidenceLoading, setWorkbenchEvidenceLoading] = useState(false);
	const [workbenchEvidenceError, setWorkbenchEvidenceError] = useState<string | null>(null);
	const [workbenchTextFile, setWorkbenchTextFile] = useState<TaskTextFileContent | null>(null);
	const [workbenchArtifactContent, setWorkbenchArtifactContent] = useState<SharedArtifactContent | null>(null);
	const [workbenchPreviewLoading, setWorkbenchPreviewLoading] = useState(false);
	const [workbenchPreviewError, setWorkbenchPreviewError] = useState<string | null>(null);
	const [runtimeSearch, setRuntimeSearch] = useState('');

	const detailReady = Boolean(task) && !loading && !error;
	const sessionsEnabled = (tab === 'sessions' || tab === 'workbench') && detailReady;
	const {
		sessions,
		selectedAgentInstance,
		finalOutput,
		runtimeEvents,
		runtimeStderr,
		loading: sessionsLoading,
		error: sessionsError,
		refresh: refreshSessions,
		selectAgentInstance,
	} = useSubagentSessions(task?.id ?? null, {
		enabled: sessionsEnabled,
		pollIntervalMs: 2000,
		eventsTailLimit: 200,
		autoFollow: sessionAutoFollow,
	});

	const artifactsEnabled = tab === 'artifacts' && detailReady;
	const {
		items: artifacts,
		selectedPath: selectedArtifactPath,
		content: artifactContent,
		loading: artifactsLoading,
		error: artifactsError,
		refresh: refreshArtifacts,
		selectArtifact,
	} = useSharedArtifacts(task?.id ?? null, artifactCategory, {
		enabled: artifactsEnabled,
		pollIntervalMs: 2000,
	});

	const { finalStatus, finalSummary } = useMemo(() => {
		if (!finalOutput?.json || typeof finalOutput.json !== 'object') {
			return { finalStatus: null, finalSummary: null };
		}

		const json = finalOutput.json as Record<string, unknown>;
		return {
			finalStatus: typeof json.status === 'string' ? json.status : null,
			finalSummary: typeof json.summary === 'string' ? json.summary : null,
		};
	}, [finalOutput]);

	const runtimeQuery = runtimeSearch.trim().toLowerCase();
	const filteredRuntimeEvents = useMemo(() => {
		if (!runtimeQuery) return runtimeEvents;
		return runtimeEvents.filter((line) => line.toLowerCase().includes(runtimeQuery));
	}, [runtimeEvents, runtimeQuery]);

	const filteredRuntimeStderr = useMemo(() => {
		if (!runtimeQuery) return runtimeStderr;
		return runtimeStderr.filter((line) => line.toLowerCase().includes(runtimeQuery));
	}, [runtimeStderr, runtimeQuery]);

	const selectedArtifact = useMemo(() => artifacts.find((item) => item.path === selectedArtifactPath) ?? null, [artifacts, selectedArtifactPath]);
	const isMarkdown = useMemo(() => isMarkdownFile(selectedArtifact?.path), [selectedArtifact]);
	const workbenchEnabled = tab === 'workbench' && detailReady;
	const workbenchSelectionKey = useMemo(() => (workbenchSelected ? workbenchNodeKey(workbenchSelected) : null), [workbenchSelected]);

	const refreshWorkbenchArtifacts = useCallback(async () => {
		if (!task) return;
		setWorkbenchArtifactsLoading(true);
		try {
			const [reports, contracts, decisions] = await Promise.all([
				apiClient.listSharedArtifacts(task.id, 'reports'),
				apiClient.listSharedArtifacts(task.id, 'contracts'),
				apiClient.listSharedArtifacts(task.id, 'decisions'),
			]);
			setWorkbenchArtifactsByCategory({ reports, contracts, decisions });
			setWorkbenchArtifactsError(null);
		} catch (err) {
			setWorkbenchArtifactsError(err instanceof Error ? err.message : 'Failed to load artifacts');
		} finally {
			setWorkbenchArtifactsLoading(false);
		}
	}, [task]);

	const refreshWorkbenchEvidence = useCallback(async () => {
		if (!task) return;
		setWorkbenchEvidenceLoading(true);
		try {
			const entries = await apiClient.taskListDir(task.id, 'shared/evidence');
			setWorkbenchEvidenceEntries(
				entries.map((entry) => ({
					path: entry.path,
					name: entry.name,
					kind: entry.isDirectory ? 'dir' : 'file',
					updatedAtMs: entry.updatedAtMs,
					sizeBytes: entry.sizeBytes,
				}))
			);
			setWorkbenchEvidenceError(null);
		} catch (err) {
			setWorkbenchEvidenceError(err instanceof Error ? err.message : 'Failed to load evidence');
		} finally {
			setWorkbenchEvidenceLoading(false);
		}
	}, [task]);

	const refreshWorkbenchPreview = useCallback(async () => {
		if (!task || !workbenchSelected) return;
		setWorkbenchPreviewLoading(true);
		setWorkbenchPreviewError(null);
		setWorkbenchTextFile(null);
		setWorkbenchArtifactContent(null);

		try {
			if (workbenchSelected.kind === 'sharedFile') {
				const res = await apiClient.taskReadTextFile(task.id, workbenchSelected.path, 1024 * 1024);
				setWorkbenchTextFile(res);
				return;
			}

			if (workbenchSelected.kind === 'sharedArtifact') {
				const res = await apiClient.readSharedArtifact(task.id, workbenchSelected.category, workbenchSelected.path);
				setWorkbenchArtifactContent(res);
				return;
			}

			if (workbenchSelected.kind === 'agent' && workbenchSelected.section === 'session') {
				const res = await apiClient.taskReadTextFile(task.id, `agents/${workbenchSelected.agentInstance}/session.json`, 1024 * 1024);
				setWorkbenchTextFile(res);
				return;
			}
		} catch (err) {
			setWorkbenchPreviewError(err instanceof Error ? err.message : 'Failed to load preview');
		} finally {
			setWorkbenchPreviewLoading(false);
		}
	}, [task, workbenchSelected]);

	useEffect(() => {
		if (!workbenchEnabled) return;
		refreshWorkbenchArtifacts().catch(() => {
			// ignore polling errors; keep last successful state
		});
		refreshWorkbenchEvidence().catch(() => {
			// ignore polling errors; keep last successful state
		});

		const timer = setInterval(() => {
			refreshWorkbenchArtifacts().catch(() => {
				// ignore polling errors; keep last successful state
			});
			refreshWorkbenchEvidence().catch(() => {
				// ignore polling errors; keep last successful state
			});
		}, 2000);

		return () => clearInterval(timer);
	}, [workbenchEnabled, refreshWorkbenchArtifacts, refreshWorkbenchEvidence]);

	useEffect(() => {
		if (!workbenchEnabled) return;
		if (!workbenchSelected) {
			if (selectedAgentInstance) {
				setWorkbenchSelected({ kind: 'agent', agentInstance: selectedAgentInstance, section: 'events' });
			} else {
				setWorkbenchSelected({ kind: 'sharedFile', path: 'shared/human-notes.md', label: 'human-notes.md' });
			}
		}
	}, [workbenchEnabled, workbenchSelected, selectedAgentInstance]);

	useEffect(() => {
		if (!workbenchEnabled || !sessionAutoFollow) return;
		if (!selectedAgentInstance) return;
		setWorkbenchSelected((prev) => {
			if (!prev) return { kind: 'agent', agentInstance: selectedAgentInstance, section: 'events' };
			if (prev.kind !== 'agent') return prev;
			if (prev.agentInstance === selectedAgentInstance) return prev;
			return { ...prev, agentInstance: selectedAgentInstance };
		});
	}, [workbenchEnabled, sessionAutoFollow, selectedAgentInstance]);

	useEffect(() => {
		if (!workbenchEnabled) return;
		if (!workbenchSelected) return;
		if (workbenchSelected.kind === 'agent') {
			selectAgentInstance(workbenchSelected.agentInstance);
		}
		const needsFilePreview =
			workbenchSelected.kind === 'sharedFile' || workbenchSelected.kind === 'sharedArtifact' || (workbenchSelected.kind === 'agent' && workbenchSelected.section === 'session');
		if (needsFilePreview) {
			refreshWorkbenchPreview().catch(() => {
				// ignore preview refresh errors; surface via state
			});
		} else {
			setWorkbenchTextFile(null);
			setWorkbenchArtifactContent(null);
			setWorkbenchPreviewError(null);
			setWorkbenchPreviewLoading(false);
		}
	}, [workbenchEnabled, workbenchSelectionKey, workbenchSelected, selectAgentInstance, refreshWorkbenchPreview]);

	if (loading) {
			return (
				<section className="rounded-2xl border border-white/10 bg-bg-menu p-6">
				<div className="text-sm text-text-muted">Loading…</div>
			</section>
		);
	}

	if (error) {
			return (
				<section className="rounded-2xl border border-white/10 bg-bg-menu p-6">
				<div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{error}</div>
			</section>
		);
	}

	if (!task) {
			return (
				<section className="rounded-2xl border border-white/10 bg-bg-menu p-6">
				<div className="text-sm text-text-muted">Select a task to see details.</div>
			</section>
		);
	}

		return (
			<section className="rounded-2xl border border-white/10 bg-bg-menu p-6">
			<div className="mb-4 flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex items-center gap-3">
						<h2 className="truncate text-lg font-semibold">{task.title}</h2>
						<StatusBadge state={task.state} />
					</div>
					<div className="mt-1 text-sm text-text-muted">{task.id}</div>
				</div>
				<button
					type="button"
					className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-sm hover:border-white/20"
					onClick={onClose}
					title="Close"
				>
					✕
				</button>
			</div>

			<div className="mb-5 flex items-center gap-2 border-b border-white/10 pb-3">
				{TABS.map(({ id, label }) => (
					<button
						key={id}
						type="button"
						className={['rounded-md px-3 py-1.5 text-sm', tab === id ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text-main'].join(' ')}
						onClick={() => setTab(id)}
					>
						{label}
					</button>
				))}
			</div>

			{tab === 'overview' && (
				<div className="space-y-6">
					<div>
						<h3 className="text-sm font-semibold">Info</h3>
						<div className="mt-3 grid grid-cols-2 gap-3 text-sm">
							<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3">
								<div className="text-xs uppercase tracking-wide text-text-muted">Topology</div>
								<div className="mt-1 font-mono">{task.topology}</div>
							</div>
							<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3">
								<div className="text-xs uppercase tracking-wide text-text-muted">State</div>
								<div className="mt-1 font-mono">{task.state}</div>
							</div>
							<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3">
								<div className="text-xs uppercase tracking-wide text-text-muted">Created</div>
								<div className="mt-1 font-mono">{formatDate(task.createdAt)}</div>
							</div>
							<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3">
								<div className="text-xs uppercase tracking-wide text-text-muted">Updated</div>
								<div className="mt-1 font-mono">{formatDate(task.updatedAt)}</div>
							</div>
						</div>
						{task.description ? (
							<div className="mt-4 rounded-lg border border-white/10 bg-bg-panelHover p-3 text-sm text-text-muted">{task.description}</div>
						) : null}
					</div>

					{task.gates?.length ? (
						<div>
							<h3 className="text-sm font-semibold">Gates</h3>
							<div className="mt-3 space-y-3">
								{task.gates.map((g) => (
									<GateItem key={g.id} gate={g} />
								))}
							</div>
						</div>
					) : null}

					{task.milestones?.length ? (
						<div>
							<h3 className="text-sm font-semibold">Milestones</h3>
							<div className="mt-3 space-y-3">
								{task.milestones.map((m) => (
									<MilestoneItem key={m.id} milestone={m} />
								))}
							</div>
						</div>
					) : null}

					{task.roster?.length ? (
						<div>
							<h3 className="text-sm font-semibold">Roster</h3>
							<div className="mt-3 grid grid-cols-2 gap-3">
								{task.roster.map((a) => (
									<AgentCard key={a.instance} agent={a} />
								))}
							</div>
						</div>
					) : null}
				</div>
			)}

			{tab === 'workbench' && (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="text-sm font-semibold">Task Workbench</div>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-2 text-xs text-text-muted">
								<input type="checkbox" checked={sessionAutoFollow} onChange={(e) => setSessionAutoFollow(e.target.checked)} />
								<span>Auto-follow</span>
							</label>
							<button
								type="button"
								className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-sm hover:border-white/20"
								onClick={() => {
									void refreshSessions();
									void refreshWorkbenchArtifacts();
									void refreshWorkbenchEvidence();
									void refreshWorkbenchPreview();
								}}
							>
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
							{(() => {
								const expanded = (key: string) => Boolean(workbenchExpandedByKey[key]);
								const toggleExpanded = (key: string) =>
									setWorkbenchExpandedByKey((prev) => ({
										...prev,
										[key]: !prev[key],
									}));

								const isSelected = (node: WorkbenchNode) => (workbenchSelectionKey ? workbenchNodeKey(node) === workbenchSelectionKey : false);
								const indentPx = (depth: number) => 8 + depth * 14;

								const TreeButton = ({
									node,
									label,
									depth,
									meta,
								}: {
									node: WorkbenchNode;
									label: string;
									depth: number;
									meta?: ReactNode;
								}) => {
									const selected = isSelected(node);
									return (
										<button
											type="button"
											className={[
												'w-full rounded-md border px-2 py-1 text-left',
												selected ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:border-white/10 hover:bg-white/5',
											].join(' ')}
											style={{ paddingLeft: indentPx(depth) }}
											onClick={() => setWorkbenchSelected(node)}
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

								const sharedFiles: Array<Extract<WorkbenchNode, { kind: 'sharedFile' }>> = [
									{ kind: 'sharedFile', path: 'shared/state-board.md', label: 'state-board.md' },
									{ kind: 'sharedFile', path: 'shared/human-notes.md', label: 'human-notes.md' },
									{ kind: 'sharedFile', path: 'shared/context-manifest.yaml', label: 'context-manifest.yaml' },
								];

								return (
									<div className="space-y-2">
										<button
											type="button"
											className="w-full rounded-md px-2 py-1 text-left text-xs font-semibold text-text-muted hover:bg-white/5"
											onClick={() => toggleExpanded('shared')}
										>
											{expanded('shared') ? 'v' : '>'} shared/
											{workbenchArtifactsLoading || workbenchEvidenceLoading ? (
												<span className="ml-2 text-[10px] text-text-dim">loading…</span>
											) : null}
										</button>

										{expanded('shared') ? (
											<div className="space-y-1">
												{sharedFiles.map((n) => (
													<TreeButton key={workbenchNodeKey(n)} node={n} label={n.label} depth={1} />
												))}

												{ARTIFACT_CATEGORIES.map((category) => (
													<div key={`cat-${category}`} className="space-y-1">
														<button
															type="button"
															className="w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-text-muted hover:bg-white/5"
															style={{ paddingLeft: indentPx(1) }}
															onClick={() => toggleExpanded(category)}
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
														onClick={() => toggleExpanded('evidence')}
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
											onClick={() => toggleExpanded('agents')}
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
																	onClick={() => toggleExpanded(agentKey)}
																>
																	<div className="min-w-0">
																		<div className="truncate text-[12px] font-semibold text-text-main">{s.agentInstance}</div>
																		<div className="mt-0.5 text-[10px] text-text-dim">updated: {formatEpochMs(s.lastUpdatedAtMs)}</div>
																	</div>
																	<span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge}`}>{s.status}</span>
																</button>

																{expanded(agentKey) ? (
																	<div className="space-y-1">
																		<TreeButton
																			node={{ kind: 'agent', agentInstance: s.agentInstance, section: 'session' }}
																			label="session.json"
																			depth={2}
																		/>

																		<div
																			className="w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-text-muted"
																			style={{ paddingLeft: indentPx(2) }}
																		>
																			runtime/
																		</div>
																		<TreeButton
																			node={{ kind: 'agent', agentInstance: s.agentInstance, section: 'events' }}
																			label="events.jsonl"
																			depth={3}
																		/>
																		<TreeButton
																			node={{ kind: 'agent', agentInstance: s.agentInstance, section: 'stderr' }}
																			label="stderr.log"
																			depth={3}
																		/>

																		<div
																			className="w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-text-muted"
																			style={{ paddingLeft: indentPx(2) }}
																		>
																			artifacts/
																		</div>
																		<TreeButton
																			node={{ kind: 'agent', agentInstance: s.agentInstance, section: 'final' }}
																			label="final.json"
																			depth={3}
																		/>
																	</div>
																) : null}
															</div>
														);
													})
												)}
											</div>
										) : null}
									</div>
								);
							})()}
						</div>

						<div className="min-w-0 space-y-4">
							{workbenchPreviewError ? (
								<div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{workbenchPreviewError}</div>
							) : null}

							{(() => {
								if (!workbenchSelected) {
									return (
										<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">
											Select a node to preview.
										</div>
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
														onChange={(e) => setRuntimeSearch(e.target.value)}
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

									// session.json (text preview)
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
													renderTextPreview(content, workbenchTextFile?.path ?? 'session.json')
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
													renderTextPreview(workbenchArtifactContent.content, previewPath)
												)}
											</div>
											{workbenchArtifactContent?.updatedAtMs ? (
												<div className="mt-2 text-xs text-text-muted">updated: {formatEpochMs(workbenchArtifactContent.updatedAtMs)}</div>
											) : null}
										</div>
									);
								}

								// shared file (text preview)
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
												renderTextPreview(content, workbenchSelected.path)
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
			)}

			{tab === 'events' && (
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
			)}

			{tab === 'artifacts' && (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="text-sm font-semibold">Artifacts</div>
						<button
							type="button"
							className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-sm hover:border-white/20"
							onClick={() => void refreshArtifacts()}
						>
							Refresh
						</button>
					</div>

					<div className="flex flex-wrap gap-2">
						{ARTIFACT_CATEGORIES.map((category) => (
							<button
								key={category}
								type="button"
								className={[
									'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
									artifactCategory === category ? 'bg-primary/20 text-primary' : 'bg-white/10 text-text-muted hover:text-text-main',
								].join(' ')}
								onClick={() => setArtifactCategory(category)}
							>
								{category}
							</button>
						))}
					</div>

					{artifactsError ? (
						<div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{artifactsError}</div>
					) : null}

					{artifactsLoading && artifacts.length === 0 ? (
						<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">Loading artifacts…</div>
					) : artifacts.length === 0 ? (
						<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">
							No artifacts in {artifactCategory}.
						</div>
					) : (
						<div className="grid grid-cols-[320px_1fr] gap-4">
							<div className="space-y-2">
								{artifacts.map((item) => {
									const isSelected = item.path === selectedArtifactPath;
									return (
										<button
											key={item.path}
											type="button"
											className={[
												'w-full rounded-lg border px-3 py-2 text-left',
												isSelected ? 'border-primary/40 bg-primary/10' : 'border-white/10 bg-bg-panelHover hover:border-white/20',
											].join(' ')}
											onClick={() => selectArtifact(item.path)}
										>
											<div className="truncate text-sm font-semibold">{item.filename}</div>
											<div className="mt-1 text-xs text-text-muted">updated: {formatEpochMs(item.updatedAtMs)}</div>
											{item.path !== item.filename ? <div className="mt-1 truncate text-[11px] text-text-dim">{item.path}</div> : null}
										</button>
									);
								})}
							</div>

							<div className="min-w-0 space-y-4">
								{selectedArtifactPath ? (
									<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
										<div className="flex items-center justify-between gap-2">
											<div className="truncate text-sm font-semibold">{selectedArtifactPath}</div>
											<div className="text-xs text-text-muted">auto-refresh: 2s</div>
										</div>
										{selectedArtifact?.updatedAtMs ? (
											<div className="mt-1 text-xs text-text-muted">updated: {formatEpochMs(selectedArtifact.updatedAtMs)}</div>
										) : null}
										<div className="mt-3">
											{!artifactContent ? (
												<div className="text-sm text-text-muted">Loading…</div>
											) : isMarkdown ? (
												<div className="space-y-3 text-sm text-text-main">
													<ReactMarkdown>{artifactContent.content}</ReactMarkdown>
												</div>
											) : (
												<pre className="max-h-[420px] overflow-auto rounded-md bg-black/20 p-3 text-xs text-text-muted">{artifactContent.content}</pre>
											)}
										</div>
									</div>
								) : (
									<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">
										Select an artifact to preview.
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			)}

			{tab === 'sessions' && (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="text-sm font-semibold">Subagents / Sessions</div>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-2 text-xs text-text-muted">
								<input type="checkbox" checked={sessionAutoFollow} onChange={(e) => setSessionAutoFollow(e.target.checked)} />
								<span>Auto-follow</span>
							</label>
							<button
								type="button"
								className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-sm hover:border-white/20"
								onClick={() => void refreshSessions()}
							>
								Refresh
							</button>
						</div>
					</div>

					{sessionsError ? (
						<div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{sessionsError}</div>
					) : null}

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
											onClick={() => selectAgentInstance(s.agentInstance)}
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
													onChange={(e) => setRuntimeSearch(e.target.value)}
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
														<pre className="max-h-[200px] overflow-auto rounded-md bg-black/20 p-3 text-[11px] text-text-muted">{filteredRuntimeEvents.join('\n')}</pre>
													)}
												</div>

												<div>
													<div className="mb-2 text-xs font-semibold text-text-muted">stderr.log</div>
													{filteredRuntimeStderr.length === 0 ? (
														<div className="text-sm text-text-muted">No stderr output yet.</div>
													) : (
														<pre className="max-h-[200px] overflow-auto rounded-md bg-black/20 p-3 text-[11px] text-text-muted">{filteredRuntimeStderr.join('\n')}</pre>
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
			)}
		</section>
	);
}

export default TaskDetail;
