/**
 * AgentMesh Console - Main Application
 * Orchestrate your intelligent swarm.
 */

import { useState, useCallback } from 'react';
import './index.css';

// Components
import { TaskList } from './components/TaskList';
import { TaskDetail } from './components/TaskDetail';
import { NewTaskModal } from './components/NewTaskModal';

// Hooks
import { useTasks, useTaskDetail, useClusterStatus } from './hooks/useTasks';

// Types
import type { CreateTaskRequest, GateDecisionRequest } from './types/task';

// ============ Cluster Status Panel ============

interface ClusterStatusPanelProps {
  orchestratorStatus: 'online' | 'offline' | 'unknown';
  adapterStatus: 'connected' | 'disconnected' | 'unknown';
  activeAgents: number;
  maxAgents: number;
}

function ClusterStatusPanel({
  orchestratorStatus,
  adapterStatus,
  activeAgents,
  maxAgents,
}: ClusterStatusPanelProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
      case 'connected':
        return 'var(--status-success)';
      case 'offline':
      case 'disconnected':
        return 'var(--status-error)';
      default:
        return 'var(--text-dim)';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'online':
        return 'Online';
      case 'offline':
        return 'Offline';
      case 'connected':
        return 'Connected';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="glass-panel cluster-status-panel">
      <h3 className="panel-title">Cluster Status</h3>
      <div className="status-list">
        <div className="status-item">
          <span className="status-label">Orchestrator</span>
          <span
            className="status-value"
            style={{ color: getStatusColor(orchestratorStatus) }}
          >
            <span className="status-dot">●</span> {getStatusLabel(orchestratorStatus)}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Codex Adapter</span>
          <span
            className="status-value"
            style={{ color: getStatusColor(adapterStatus) }}
          >
            <span className="status-dot">●</span> {getStatusLabel(adapterStatus)}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Active Agents</span>
          <span className="status-value">
            {activeAgents} / {maxAgents}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============ Recent Events Panel ============

interface RecentEvent {
  time: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

interface RecentEventsPanelProps {
  events: RecentEvent[];
}

function RecentEventsPanel({ events }: RecentEventsPanelProps) {
  const getEventColor = (type: RecentEvent['type']) => {
    switch (type) {
      case 'success':
        return 'var(--status-success)';
      case 'warning':
        return 'var(--status-warning)';
      case 'error':
        return 'var(--status-error)';
      default:
        return 'var(--primary)';
    }
  };

  return (
    <div className="glass-panel recent-events-panel">
      <h3 className="panel-title">Recent Events</h3>
      <ul className="events-list-mini">
        {events.map((event, index) => (
          <li key={index} className="event-item-mini">
            <span
              className="event-time"
              style={{ color: getEventColor(event.type) }}
            >
              [{event.time}]
            </span>
            <span className="event-message">{event.message}</span>
          </li>
        ))}
        {events.length === 0 && (
          <li className="event-item-mini event-empty">No recent events</li>
        )}
      </ul>
    </div>
  );
}

// ============ Main App Component ============

function App() {
  // State
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  // Hooks
  const { tasks, loading, error, refresh, createTask } = useTasks(true);
  const {
    task: selectedTask,
    events: taskEvents,
    loading: taskLoading,
    error: taskError,
    hasMoreEvents,
    loadMoreEvents,
    submitGateDecision,
  } = useTaskDetail(selectedTaskId);
  const { status: clusterStatus } = useClusterStatus(10000);

  // Handlers
  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  const handleCreateTask = useCallback(async (data: CreateTaskRequest) => {
    setIsCreatingTask(true);
    try {
      const newTask = await createTask(data);
      if (newTask) {
        setSelectedTaskId(newTask.id);
      }
    } finally {
      setIsCreatingTask(false);
    }
  }, [createTask]);

  const handleGateDecision = useCallback(
    async (gateId: string, decision: GateDecisionRequest): Promise<boolean> => {
      return submitGateDecision(gateId, decision);
    },
    [submitGateDecision]
  );

  // Derive recent events from tasks
  const recentEvents: RecentEvent[] = tasks
    .slice(0, 5)
    .map((task) => {
      const time = new Date(task.updatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      let message = `Task "${task.title}"`;
      let type: RecentEvent['type'] = 'info';

      switch (task.state) {
        case 'working':
          message += ' is running';
          type = 'info';
          break;
        case 'gate.blocked':
          message += ' needs approval';
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

  return (
    <div className="container animate-enter">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">AgentMesh Console</h1>
          <p className="app-subtitle">Orchestrate your intelligent swarm.</p>
        </div>
        <div className="header-right">
          <button className="btn">Settings</button>
          <button
            className="btn btn-primary"
            onClick={() => setIsNewTaskModalOpen(true)}
          >
            + New Task
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="main-layout">
        {/* Left Column: Task List */}
        <div className="main-column">
          <TaskList
            tasks={tasks}
            loading={loading}
            error={error}
            selectedTaskId={selectedTaskId}
            onSelectTask={handleSelectTask}
            onCreateTask={() => setIsNewTaskModalOpen(true)}
            onRefresh={refresh}
          />
        </div>

        {/* Center Column: Task Detail */}
        <div className="detail-column">
          <TaskDetail
            task={selectedTask}
            events={taskEvents}
            loading={taskLoading}
            error={taskError}
            hasMoreEvents={hasMoreEvents}
            onLoadMoreEvents={loadMoreEvents}
            onGateDecision={handleGateDecision}
            onClose={handleCloseDetail}
          />
        </div>

        {/* Right Column: Status Panels */}
        <aside className="sidebar-column">
          <ClusterStatusPanel
            orchestratorStatus={clusterStatus?.orchestrator || 'unknown'}
            adapterStatus={clusterStatus?.codexAdapter || 'unknown'}
            activeAgents={clusterStatus?.activeAgents || 0}
            maxAgents={clusterStatus?.maxAgents || 10}
          />
          <RecentEventsPanel events={recentEvents} />
        </aside>
      </div>

      {/* New Task Modal */}
      <NewTaskModal
        isOpen={isNewTaskModalOpen}
        onClose={() => setIsNewTaskModalOpen(false)}
        onSubmit={handleCreateTask}
        loading={isCreatingTask}
      />
    </div>
  );
}

export default App;
