import type { Task, TaskState } from '@/types/task';
import { formatTimeAgo } from '../lib/format';
import { StatusBadge } from './StatusBadge';

function taskIcon(state: TaskState): string {
	switch (state) {
		case 'working':
			return '⚡';
		case 'input-required':
			return '🚧';
		case 'completed':
			return '✓';
		case 'failed':
			return '✕';
		default:
			return '📋';
	}
}

interface TaskListProps {
	tasks: Task[];
	loading: boolean;
	error: string | null;
	selectedTaskId: string | null;
	onSelectTask: (taskId: string) => void;
	onCreateTask?: () => void;
	onRefresh: () => void;
}

export function TaskList({ tasks, loading, error, selectedTaskId, onSelectTask, onCreateTask, onRefresh }: TaskListProps) {
	const runningCount = tasks.filter((t) => t.state === 'working').length;

	return (
		<section className="rounded-2xl border border-white/10 bg-bg-menu p-6">
			<div className="mb-5 flex items-start justify-between gap-4">
				<div>
					<h2 className="text-lg font-semibold">Tasks</h2>
					<p className="mt-1 text-sm text-text-muted">Running: {runningCount}</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-sm hover:border-white/20"
						onClick={onRefresh}
						disabled={loading}
						title="Refresh"
					>
						↻
					</button>
					{onCreateTask ? (
						<button type="button" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover" onClick={onCreateTask}>
							+ New
						</button>
					) : null}
				</div>
			</div>

			{error && <div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{error}</div>}

			{!error && tasks.length === 0 && !loading && (
				<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center">
					<div className="text-3xl">📭</div>
					<div className="mt-2 text-sm text-text-muted">No tasks yet</div>
				</div>
			)}

			<div className="mt-4 flex flex-col gap-3">
				{tasks.map((task) => {
					const isSelected = task.id === selectedTaskId;
					const blockedGates = task.gates?.filter((g) => g.state === 'blocked').length ?? 0;

					return (
						<div
							key={task.id}
							role="button"
							tabIndex={0}
							onClick={() => onSelectTask(task.id)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onSelectTask(task.id);
								}
							}}
							className={[
								'group flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3 transition',
								isSelected ? 'border-border-active bg-bg-panelHover' : 'border-white/10 bg-bg-panel',
								'hover:border-white/20',
							].join(' ')}
						>
							<div className="flex min-w-0 items-center gap-3">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">{taskIcon(task.state)}</div>
								<div className="min-w-0">
									<div className="truncate text-sm font-semibold">{task.title}</div>
									<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
										<span className="uppercase tracking-wide">{task.topology}</span>
										{task.roster?.length ? <span>{task.roster.length} agents</span> : null}
										{blockedGates ? <span>{blockedGates} blocked gates</span> : null}
									</div>
								</div>
							</div>

							<div className="flex shrink-0 flex-col items-end gap-2">
								<div className="text-xs text-text-muted">{formatTimeAgo(task.updatedAt)}</div>
								<StatusBadge state={task.state} />
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

export default TaskList;
