/**
 * TaskList Component
 * Displays a list of tasks with status badges and click-to-select functionality
 */

import type { Task, TaskState } from '../types/task';

// ============ Status Badge Component ============

interface StatusBadgeProps {
  status: TaskState;
}

const statusConfig: Record<TaskState, { label: string; className: string }> = {
  created: { label: 'CREATED', className: 'status-waiting' },
  working: { label: 'WORKING', className: 'status-active status-pulse' },
  'gate.blocked': { label: 'BLOCKED', className: 'status-blocked' },
  completed: { label: 'COMPLETED', className: 'status-completed' },
  failed: { label: 'FAILED', className: 'status-error' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status?.toUpperCase() || 'UNKNOWN', className: '' };
  return (
    <span className={`status-badge ${config.className}`}>
      {config.label}
    </span>
  );
}

// ============ Task Card Component ============

interface TaskCardProps {
  task: Task;
  isSelected: boolean;
  onClick: () => void;
}

function getTaskIcon(state: TaskState): string {
  switch (state) {
    case 'working':
      return '⚡';
    case 'gate.blocked':
      return '🚧';
    case 'completed':
      return '✓';
    case 'failed':
      return '✕';
    default:
      return '📋';
  }
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

export function TaskCard({ task, isSelected, onClick }: TaskCardProps) {
  const agentCount = task.roster?.length || 0;
  const pendingGates = task.gates?.filter((g) => g.status === 'pending').length || 0;

  return (
    <div
      className={`card task-card ${isSelected ? 'task-card-selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="task-card-content">
        <div className="task-card-icon">
          {getTaskIcon(task.state)}
        </div>
        <div className="task-card-info">
          <h3 className="task-card-title">{task.title}</h3>
          <div className="task-card-meta">
            <span className="task-card-topology">{task.topology}</span>
            {agentCount > 0 && (
              <span className="task-card-agents">{agentCount} agent{agentCount > 1 ? 's' : ''}</span>
            )}
            {pendingGates > 0 && (
              <span className="task-card-gates">{pendingGates} pending gate{pendingGates > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </div>
      <div className="task-card-right">
        <span className="task-card-time">{formatTimeAgo(task.updatedAt)}</span>
        <StatusBadge status={task.state} />
      </div>
    </div>
  );
}

// ============ Loading Skeleton ============

function TaskCardSkeleton() {
  return (
    <div className="card task-card task-card-skeleton">
      <div className="task-card-content">
        <div className="skeleton skeleton-icon" />
        <div className="task-card-info">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-meta" />
        </div>
      </div>
      <div className="task-card-right">
        <div className="skeleton skeleton-badge" />
      </div>
    </div>
  );
}

// ============ Empty State ============

interface EmptyStateProps {
  onCreateTask: () => void;
}

function EmptyState({ onCreateTask }: EmptyStateProps) {
  return (
    <div className="task-list-empty">
      <div className="task-list-empty-icon">📭</div>
      <h3>No tasks yet</h3>
      <p>Create your first task to get started with AgentMesh.</p>
      <button className="btn btn-primary" onClick={onCreateTask}>
        + New Task
      </button>
    </div>
  );
}

// ============ Error State ============

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="task-list-error">
      <div className="task-list-error-icon">⚠️</div>
      <h3>Failed to load tasks</h3>
      <p>{message}</p>
      <button className="btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// ============ Main TaskList Component ============

interface TaskListProps {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onCreateTask: () => void;
  onRefresh: () => void;
}

export function TaskList({
  tasks,
  loading,
  error,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
  onRefresh,
}: TaskListProps) {
  // Calculate stats
  const runningCount = tasks.filter((t) => t.state === 'working').length;

  if (error) {
    return (
      <section className="glass-panel task-list-panel">
        <ErrorState message={error} onRetry={onRefresh} />
      </section>
    );
  }

  return (
    <section className="glass-panel task-list-panel">
      <div className="task-list-header">
        <div className="task-list-header-left">
          <h2>Active Tasks</h2>
          <span className="task-list-count">
            Running: {runningCount}
          </span>
        </div>
        <button
          className="btn btn-icon"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh"
        >
          <span className={loading ? 'spin' : ''}>↻</span>
        </button>
      </div>

      <div className="task-list-content">
        {loading && tasks.length === 0 ? (
          // Show skeletons while loading
          <>
            <TaskCardSkeleton />
            <TaskCardSkeleton />
            <TaskCardSkeleton />
          </>
        ) : tasks.length === 0 ? (
          <EmptyState onCreateTask={onCreateTask} />
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              onClick={() => onSelectTask(task.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default TaskList;
