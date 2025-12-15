/**
 * TaskDetail Component
 * Displays detailed information about a selected task with tabs
 */

import { useState } from 'react';
import type {
  Task,
  TaskEvent,
  AgentInstance,
  Milestone,
  Gate,
  GateDecisionRequest,
} from '../types/task';
import { StatusBadge } from './TaskList';

// ============ Types ============

type TabId = 'overview' | 'reports' | 'events' | 'sessions';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reports', label: 'Reports' },
  { id: 'events', label: 'Events' },
  { id: 'sessions', label: 'Sessions' },
];

// ============ Helper Functions ============

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

// ============ Milestone Component ============

interface MilestoneItemProps {
  milestone: Milestone;
}

function MilestoneItem({ milestone }: MilestoneItemProps) {
  const statusIcon = {
    pending: '○',
    in_progress: '◐',
    completed: '●',
  }[milestone.status];

  const statusClass = {
    pending: 'milestone-pending',
    in_progress: 'milestone-progress',
    completed: 'milestone-completed',
  }[milestone.status];

  return (
    <div className={`milestone-item ${statusClass}`}>
      <span className="milestone-icon">{statusIcon}</span>
      <div className="milestone-content">
        <span className="milestone-title">{milestone.title}</span>
        {milestone.description && (
          <span className="milestone-desc">{milestone.description}</span>
        )}
      </div>
    </div>
  );
}

// ============ Gate Component ============

interface GateItemProps {
  gate: Gate;
  onDecision: (gateId: string, decision: GateDecisionRequest) => void;
}

function GateItem({ gate, onDecision }: GateItemProps) {
  const isPending = gate.status === 'pending';

  return (
    <div className={`gate-item gate-${gate.status}`}>
      <div className="gate-header">
        <span className="gate-type">{gate.type.toUpperCase()}</span>
        <span className={`gate-status gate-status-${gate.status}`}>
          {gate.status}
        </span>
      </div>
      <h4 className="gate-title">{gate.title}</h4>
      {gate.description && (
        <p className="gate-description">{gate.description}</p>
      )}
      <div className="gate-meta">
        <span>Requested: {formatDate(gate.requestedAt)}</span>
        {gate.resolvedAt && <span>Resolved: {formatDate(gate.resolvedAt)}</span>}
      </div>
      {isPending && (
        <div className="gate-actions">
          <button
            className="btn btn-approve"
            onClick={() => onDecision(gate.id, { decision: 'approve' })}
          >
            Approve
          </button>
          <button
            className="btn btn-deny"
            onClick={() => onDecision(gate.id, { decision: 'deny' })}
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

// ============ Agent Card Component ============

interface AgentCardProps {
  agent: AgentInstance;
}

function AgentCard({ agent }: AgentCardProps) {
  const stateClass = {
    active: 'agent-active',
    awaiting: 'agent-awaiting',
    dormant: 'agent-dormant',
  }[agent.state];

  return (
    <div className={`agent-card ${stateClass}`}>
      <div className="agent-header">
        <span className="agent-name">{agent.name}</span>
        <span className={`agent-state agent-state-${agent.state}`}>
          {agent.state}
        </span>
      </div>
      <div className="agent-role">{agent.role}</div>
      {agent.sessionId && (
        <div className="agent-session">Session: {agent.sessionId.slice(0, 8)}...</div>
      )}
    </div>
  );
}

// ============ Event Item Component ============

interface EventItemProps {
  event: TaskEvent;
}

function EventItem({ event }: EventItemProps) {
  const eventTypeColors: Record<string, string> = {
    'task.': 'var(--primary)',
    'agent.': 'var(--accent)',
    'gate.': 'var(--status-warning)',
    'turn.': 'var(--status-info)',
    'artifact.': 'var(--status-success)',
    'milestone.': 'var(--status-success)',
  };

  const getEventColor = (type: string): string => {
    for (const [prefix, color] of Object.entries(eventTypeColors)) {
      if (type.startsWith(prefix)) return color;
    }
    return 'var(--text-muted)';
  };

  return (
    <div className="event-item">
      <div className="event-timestamp">
        {formatDate(event.timestamp)}
      </div>
      <div className="event-content">
        <span
          className="event-type"
          style={{ color: getEventColor(event.type) }}
        >
          [{event.type}]
        </span>
        {event.agentId && (
          <span className="event-agent">@{event.agentId}</span>
        )}
        {'message' in event.payload && (
          <span className="event-message">
            {String(event.payload.message ?? '')}
          </span>
        )}
      </div>
    </div>
  );
}

// ============ Tab Content Components ============

interface OverviewTabProps {
  task: Task;
  onGateDecision: (gateId: string, decision: GateDecisionRequest) => void;
}

function OverviewTab({ task, onGateDecision }: OverviewTabProps) {
  const pendingGates = task.gates?.filter((g) => g.status === 'pending') || [];

  return (
    <div className="tab-content overview-tab">
      {/* Task Info */}
      <div className="overview-section">
        <h3>Task Information</h3>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">ID</span>
            <span className="info-value">{task.id}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Topology</span>
            <span className="info-value">{task.topology}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Created</span>
            <span className="info-value">{formatDate(task.createdAt)}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Updated</span>
            <span className="info-value">{formatDate(task.updatedAt)}</span>
          </div>
        </div>
        {task.description && (
          <p className="task-description">{task.description}</p>
        )}
      </div>

      {/* Pending Gates (Priority) */}
      {pendingGates.length > 0 && (
        <div className="overview-section gates-section">
          <h3>
            <span className="section-icon">🚧</span>
            Pending Gates ({pendingGates.length})
          </h3>
          <div className="gates-list">
            {pendingGates.map((gate) => (
              <GateItem
                key={gate.id}
                gate={gate}
                onDecision={onGateDecision}
              />
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      {task.milestones && task.milestones.length > 0 && (
        <div className="overview-section">
          <h3>Milestones</h3>
          <div className="milestones-list">
            {task.milestones.map((milestone) => (
              <MilestoneItem key={milestone.id} milestone={milestone} />
            ))}
          </div>
        </div>
      )}

      {/* Roster */}
      {task.roster && task.roster.length > 0 && (
        <div className="overview-section">
          <h3>Agent Roster ({task.roster.length})</h3>
          <div className="agents-grid">
            {task.roster.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ReportsTabProps {
  task: Task;
}

function ReportsTab({ task }: ReportsTabProps) {
  const reports = task.reports || [];

  if (reports.length === 0) {
    return (
      <div className="tab-content tab-empty">
        <div className="empty-icon">📄</div>
        <p>No reports available yet.</p>
      </div>
    );
  }

  return (
    <div className="tab-content reports-tab">
      {reports.map((report) => (
        <div key={report.id} className="report-item card">
          <div className="report-header">
            <h4>{report.title}</h4>
            <span className="report-type">{report.type}</span>
          </div>
          <div className="report-path">{report.path}</div>
          <div className="report-meta">
            Updated: {formatDate(report.updatedAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

interface EventsTabProps {
  events: TaskEvent[];
  hasMore: boolean;
  onLoadMore: () => void;
}

function EventsTab({ events, hasMore, onLoadMore }: EventsTabProps) {
  if (events.length === 0) {
    return (
      <div className="tab-content tab-empty">
        <div className="empty-icon">📋</div>
        <p>No events recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="tab-content events-tab">
      <div className="events-list">
        {events.map((event) => (
          <EventItem key={event.id} event={event} />
        ))}
      </div>
      {hasMore && (
        <button className="btn btn-load-more" onClick={onLoadMore}>
          Load More Events
        </button>
      )}
    </div>
  );
}

interface SessionsTabProps {
  roster: AgentInstance[];
}

function SessionsTab({ roster }: SessionsTabProps) {
  if (!roster || roster.length === 0) {
    return (
      <div className="tab-content tab-empty">
        <div className="empty-icon">👥</div>
        <p>No active sessions.</p>
      </div>
    );
  }

  return (
    <div className="tab-content sessions-tab">
      <div className="sessions-list">
        {roster.map((agent) => (
          <div key={agent.id} className="session-card card">
            <div className="session-header">
              <h4>{agent.name}</h4>
              <span className={`agent-state agent-state-${agent.state}`}>
                {agent.state}
              </span>
            </div>
            <div className="session-details">
              <div className="session-detail">
                <span className="detail-label">Role:</span>
                <span className="detail-value">{agent.role}</span>
              </div>
              {agent.sessionId && (
                <div className="session-detail">
                  <span className="detail-label">Session ID:</span>
                  <span className="detail-value mono">{agent.sessionId}</span>
                </div>
              )}
              {agent.cwd && (
                <div className="session-detail">
                  <span className="detail-label">Working Dir:</span>
                  <span className="detail-value mono">{agent.cwd}</span>
                </div>
              )}
              {agent.artifacts && agent.artifacts.length > 0 && (
                <div className="session-artifacts">
                  <span className="detail-label">Artifacts:</span>
                  <ul>
                    {agent.artifacts.map((artifact, i) => (
                      <li key={i}>{artifact}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ Main TaskDetail Component ============

interface TaskDetailProps {
  task: Task | null;
  events: TaskEvent[];
  loading: boolean;
  error: string | null;
  hasMoreEvents: boolean;
  onLoadMoreEvents: () => void;
  onGateDecision: (gateId: string, decision: GateDecisionRequest) => Promise<boolean>;
  onClose: () => void;
}

export function TaskDetail({
  task,
  events,
  loading,
  error,
  hasMoreEvents,
  onLoadMoreEvents,
  onGateDecision,
  onClose,
}: TaskDetailProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // No task selected
  if (!task && !loading) {
    return (
      <div className="task-detail-placeholder glass-panel">
        <div className="placeholder-content">
          <div className="placeholder-icon">📋</div>
          <h3>Select a task</h3>
          <p>Choose a task from the list to view its details.</p>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading && !task) {
    return (
      <div className="task-detail glass-panel">
        <div className="task-detail-loading">
          <div className="loading-spinner" />
          <p>Loading task details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="task-detail glass-panel">
        <div className="task-detail-error">
          <div className="error-icon">⚠️</div>
          <h3>Error loading task</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!task) return null;

  const handleGateDecision = async (gateId: string, decision: GateDecisionRequest) => {
    await onGateDecision(gateId, decision);
  };

  return (
    <div className="task-detail glass-panel">
      {/* Header */}
      <div className="task-detail-header">
        <div className="task-detail-header-left">
          <h2 className="task-detail-title">{task.title}</h2>
          <StatusBadge status={task.state} />
        </div>
        <button className="btn btn-icon" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {/* Tabs */}
      <div className="task-detail-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'tab-btn-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="task-detail-content">
        {activeTab === 'overview' && (
          <OverviewTab task={task} onGateDecision={handleGateDecision} />
        )}
        {activeTab === 'reports' && <ReportsTab task={task} />}
        {activeTab === 'events' && (
          <EventsTab
            events={events}
            hasMore={hasMoreEvents}
            onLoadMore={onLoadMoreEvents}
          />
        )}
        {activeTab === 'sessions' && <SessionsTab roster={task.roster} />}
      </div>
    </div>
  );
}

export default TaskDetail;
