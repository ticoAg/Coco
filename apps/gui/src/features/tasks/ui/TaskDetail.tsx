import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import type { SharedArtifactCategory, SharedArtifactContent, SharedArtifactSummary, Task, TaskDirEntry, TaskEvent, TaskTextFileContent } from '@/types/task';
import { useSharedArtifacts, useSubagentSessions } from '../model';
import { type WorkbenchNode, workbenchNodeKey } from '../model/workbench';
import { StatusBadge } from './StatusBadge';
import { OverviewTab } from './tabs/OverviewTab';
import { WorkbenchTab } from './tabs/WorkbenchTab';
import { EventsTab } from './tabs/EventsTab';
import { ArtifactsTab } from './tabs/ArtifactsTab';
import { SessionsTab } from './tabs/SessionsTab';

type TabId = 'overview' | 'workbench' | 'events' | 'artifacts' | 'sessions';
const TABS: Array<{ id: TabId; label: string }> = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'workbench', label: 'Workbench' },
	{ id: 'events', label: 'Events' },
	{ id: 'artifacts', label: 'Artifacts' },
	{ id: 'sessions', label: 'Sessions' },
];

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
			workbenchSelected.kind === 'sharedFile' ||
			workbenchSelected.kind === 'sharedArtifact' ||
			(workbenchSelected.kind === 'agent' && workbenchSelected.section === 'session');
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

	const handleToggleExpanded = useCallback((key: string) => {
		setWorkbenchExpandedByKey((prev) => ({
			...prev,
			[key]: !prev[key],
		}));
	}, []);

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

			{tab === 'overview' && <OverviewTab task={task} />}

			{tab === 'workbench' && (
				<WorkbenchTab
					sessionAutoFollow={sessionAutoFollow}
					onToggleAutoFollow={setSessionAutoFollow}
					onRefresh={() => {
						void refreshSessions();
						void refreshWorkbenchArtifacts();
						void refreshWorkbenchEvidence();
						void refreshWorkbenchPreview();
					}}
					workbenchArtifactsByCategory={workbenchArtifactsByCategory}
					workbenchArtifactsLoading={workbenchArtifactsLoading}
					workbenchArtifactsError={workbenchArtifactsError}
					workbenchEvidenceEntries={workbenchEvidenceEntries}
					workbenchEvidenceLoading={workbenchEvidenceLoading}
					workbenchEvidenceError={workbenchEvidenceError}
					workbenchSelected={workbenchSelected}
					workbenchSelectionKey={workbenchSelectionKey}
					workbenchExpandedByKey={workbenchExpandedByKey}
					onToggleExpanded={handleToggleExpanded}
					onSelectNode={setWorkbenchSelected}
					workbenchPreviewError={workbenchPreviewError}
					workbenchPreviewLoading={workbenchPreviewLoading}
					workbenchTextFile={workbenchTextFile}
					workbenchArtifactContent={workbenchArtifactContent}
					sessions={sessions}
					sessionsLoading={sessionsLoading}
					finalOutput={finalOutput}
					finalStatus={finalStatus}
					finalSummary={finalSummary}
					runtimeSearch={runtimeSearch}
					onRuntimeSearchChange={setRuntimeSearch}
					filteredRuntimeEvents={filteredRuntimeEvents}
					filteredRuntimeStderr={filteredRuntimeStderr}
				/>
			)}

			{tab === 'events' && <EventsTab events={events} hasMoreEvents={hasMoreEvents} onLoadMoreEvents={onLoadMoreEvents} />}

			{tab === 'artifacts' && (
				<ArtifactsTab
					artifactCategory={artifactCategory}
					onSelectCategory={setArtifactCategory}
					artifacts={artifacts}
					selectedArtifactPath={selectedArtifactPath}
					selectedArtifact={selectedArtifact}
					artifactContent={artifactContent}
					artifactsLoading={artifactsLoading}
					artifactsError={artifactsError}
					onRefresh={() => void refreshArtifacts()}
					onSelectArtifact={selectArtifact}
				/>
			)}

			{tab === 'sessions' && (
				<SessionsTab
					sessions={sessions}
					sessionsLoading={sessionsLoading}
					sessionsError={sessionsError}
					selectedAgentInstance={selectedAgentInstance}
					finalStatus={finalStatus}
					finalSummary={finalSummary}
					finalOutput={finalOutput}
					runtimeSearch={runtimeSearch}
					onRuntimeSearchChange={setRuntimeSearch}
					filteredRuntimeEvents={filteredRuntimeEvents}
					filteredRuntimeStderr={filteredRuntimeStderr}
					sessionAutoFollow={sessionAutoFollow}
					onToggleAutoFollow={setSessionAutoFollow}
					onRefresh={() => void refreshSessions()}
					onSelectAgentInstance={selectAgentInstance}
				/>
			)}
		</section>
	);
}

export default TaskDetail;
