import { useCallback, useMemo, useState } from 'react';

import './index.css';

import { CodexChat } from './components/CodexChat';
import { NewTaskModal } from './components/NewTaskModal';
import { TaskDetail } from './components/TaskDetail';
import { TaskList } from './components/TaskList';
import { useClusterStatus, useTaskDetail, useTasks } from './hooks/useTasks';
import type { CreateTaskRequest, Task } from './types/task';

function ClusterStatusPanel({ status }: { status: ReturnType<typeof useClusterStatus>['status'] }) {
	return (
		<div className="rounded-2xl border border-white/10 bg-bg-panel/70 p-6 backdrop-blur">
			<h3 className="text-sm font-semibold">Cluster Status</h3>
			{!status ? (
				<div className="mt-3 text-sm text-text-muted">Loading…</div>
			) : (
				<div className="mt-4 space-y-3 text-sm">
					<div className="flex items-center justify-between">
						<span className="text-text-muted">Orchestrator</span>
						<span className="font-mono">{status.orchestrator}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-text-muted">Codex Adapter</span>
						<span className="font-mono">{status.codexAdapter}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-text-muted">Active Agents</span>
						<span className="font-mono">
							{status.activeAgents} / {status.maxAgents}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}

type RecentEventType = 'info' | 'warning' | 'error' | 'success';

interface RecentEvent {
	time: string;
	message: string;
	type: RecentEventType;
}

function RecentEventsPanel({ tasks }: { tasks: Task[] }) {
	const recentEvents = useMemo<RecentEvent[]>(() => {
		return tasks.slice(0, 5).map((task) => {
			const time = new Date(task.updatedAt).toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
			});
			let message = `Task "${task.title}"`;
			let type: RecentEventType = 'info';

			switch (task.state) {
				case 'working':
					message += ' is running';
					type = 'info';
					break;
				case 'input-required':
					message += ' is blocked';
					type = 'warning';
					break;
				case 'completed':
					message += ' completed';
					type = 'success';
					break;
				case 'failed':
					message += ' failed';
					type = 'error';
					break;
				default:
					message += ` (${task.state})`;
			}

			return { time, message, type };
		});
	}, [tasks]);

	const color = (type: RecentEventType) => {
		switch (type) {
			case 'success':
				return 'text-status-success';
			case 'warning':
				return 'text-status-warning';
			case 'error':
				return 'text-status-error';
			default:
				return 'text-primary';
		}
	};

	return (
		<div className="rounded-2xl border border-white/10 bg-bg-panel/70 p-6 backdrop-blur">
			<h3 className="text-sm font-semibold">Recent</h3>
			<div className="mt-4 space-y-2 text-xs">
				{recentEvents.length ? (
					recentEvents.map((ev, idx) => (
						<div key={idx} className="flex gap-2">
							<span className={`font-mono ${color(ev.type)}`}>[{ev.time}]</span>
							<span className="text-text-muted">{ev.message}</span>
						</div>
					))
				) : (
					<div className="text-text-dim">No recent events</div>
				)}
			</div>
		</div>
	);
}

function TaskDashboard({ enableTaskAuthoring }: { enableTaskAuthoring: boolean }) {
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
	const [isCreatingTask, setIsCreatingTask] = useState(false);

	const { tasks, loading, error, refresh, createTask } = useTasks(true);
	const { task, events, loading: taskLoading, error: taskError, hasMoreEvents, loadMoreEvents } = useTaskDetail(selectedTaskId);
	const { status: clusterStatus } = useClusterStatus(10000);

	const handleSelectTask = useCallback((taskId: string) => {
		setSelectedTaskId(taskId);
	}, []);

	const handleCreateTask = useCallback(
		async (data: CreateTaskRequest) => {
			setIsCreatingTask(true);
			try {
				const newId = await createTask(data);
				if (newId) setSelectedTaskId(newId);
			} finally {
				setIsCreatingTask(false);
			}
		},
		[createTask]
	);

	return (
		<div className="h-full overflow-auto p-8">
			<div className="grid grid-cols-[1fr_1.3fr_320px] gap-6">
				<div className="min-w-0">
					<TaskList
						tasks={tasks}
						loading={loading}
						error={error}
						selectedTaskId={selectedTaskId}
						onSelectTask={handleSelectTask}
						onCreateTask={enableTaskAuthoring ? () => setIsNewTaskModalOpen(true) : undefined}
						onRefresh={refresh}
					/>
				</div>

				<div className="min-w-0">
					<TaskDetail
						task={task}
						events={events}
						loading={taskLoading}
						error={taskError}
						hasMoreEvents={hasMoreEvents}
						onLoadMoreEvents={loadMoreEvents}
						onClose={() => setSelectedTaskId(null)}
					/>
				</div>

				<aside className="space-y-6">
					<ClusterStatusPanel status={clusterStatus} />
					<RecentEventsPanel tasks={tasks} />
				</aside>
			</div>

			{enableTaskAuthoring ? (
				<NewTaskModal isOpen={isNewTaskModalOpen} onClose={() => setIsNewTaskModalOpen(false)} onSubmit={handleCreateTask} loading={isCreatingTask} />
			) : null}
		</div>
	);
}

type View = 'tasks' | 'codex';

export default function App() {
	const enableTaskAuthoring = import.meta.env.VITE_AGENTMESH_ENABLE_TASK_AUTHORING === '1';
	const [view, setView] = useState<View>('codex');

	return (
		<div className="flex h-full flex-col bg-bg-app text-text-main">
			<header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-2">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold">AgentMesh</div>
					<div className="truncate text-[11px] text-text-muted">{view === 'codex' ? 'Codex Chat' : 'Tasks Workbench'}</div>
				</div>

				<div className="flex items-center gap-3">
					<div className="flex overflow-hidden rounded-md border border-white/10 bg-bg-panel/70 backdrop-blur">
						<button
							type="button"
							className={['px-4 py-2 text-sm transition', view === 'tasks' ? 'bg-bg-panelHover font-semibold' : 'text-text-muted hover:text-text-main'].join(' ')}
							onClick={() => setView('tasks')}
						>
							Tasks
						</button>
						<button
							type="button"
							className={['px-4 py-2 text-sm transition', view === 'codex' ? 'bg-bg-panelHover font-semibold' : 'text-text-muted hover:text-text-main'].join(' ')}
							onClick={() => setView('codex')}
						>
							Codex
						</button>
					</div>
				</div>
			</header>

			<main className="min-h-0 flex-1">{view === 'codex' ? <CodexChat /> : <TaskDashboard enableTaskAuthoring={enableTaskAuthoring} />}</main>
		</div>
	);
}

