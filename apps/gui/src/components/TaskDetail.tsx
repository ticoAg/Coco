import { useMemo, useState } from 'react'
import type { AgentInstance, Gate, Milestone, Task, TaskEvent } from '../types/task'
import { StatusBadge } from './TaskList'

type TabId = 'overview' | 'events'

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString()
}

function MilestoneItem({ milestone }: { milestone: Milestone }) {
  const icon = {
    pending: '○',
    working: '◐',
    done: '●',
    blocked: '⚠',
  }[milestone.state]

  const color = {
    pending: 'text-text-muted',
    working: 'text-status-info',
    done: 'text-status-success',
    blocked: 'text-status-warning',
  }[milestone.state]

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
  )
}

function AgentCard({ agent }: { agent: AgentInstance }) {
  const color = {
    pending: 'text-text-muted',
    active: 'text-status-info',
    awaiting: 'text-text-muted',
    dormant: 'text-text-dim',
    completed: 'text-status-success',
    failed: 'text-status-error',
  }[agent.state]

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
            <span
              key={s}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-text-muted"
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function GateItem({ gate }: { gate: Gate }) {
  const badge = {
    open: 'bg-white/10 text-text-muted',
    blocked: 'bg-status-warning/15 text-status-warning',
    approved: 'bg-status-success/15 text-status-success',
    rejected: 'bg-status-error/15 text-status-error',
  }[gate.state]

  return (
    <div className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-text-muted">{gate.type}</div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>
          {gate.state}
        </span>
      </div>
      {gate.reason ? <div className="mt-2 text-sm">{gate.reason}</div> : null}
      <div className="mt-2 text-xs text-text-muted">
        {gate.instructionsRef ? `instructions: ${gate.instructionsRef}` : null}
      </div>
    </div>
  )
}

function EventItem({ event }: { event: TaskEvent }) {
  const payloadMessage = useMemo(() => {
    if (!event.payload || typeof event.payload !== 'object') return null
    const p = event.payload as Record<string, unknown>
    if (typeof p.message === 'string') return p.message
    return null
  }, [event.payload])

  return (
    <div className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
      <div className="text-xs text-text-dim">{formatDate(event.ts)}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs text-accent">[{event.type}]</span>
        {event.agentInstance ? <span className="text-xs text-text-muted">@{event.agentInstance}</span> : null}
        {payloadMessage ? <span className="text-text-muted">{payloadMessage}</span> : null}
      </div>
    </div>
  )
}

interface TaskDetailProps {
  task: Task | null
  events: TaskEvent[]
  loading: boolean
  error: string | null
  hasMoreEvents: boolean
  onLoadMoreEvents: () => void
  onClose: () => void
}

export function TaskDetail({
  task,
  events,
  loading,
  error,
  hasMoreEvents,
  onLoadMoreEvents,
  onClose,
}: TaskDetailProps) {
  const [tab, setTab] = useState<TabId>('overview')

  if (loading) {
    return (
      <section className="rounded-2xl border border-white/10 bg-bg-panel/70 p-6 backdrop-blur">
        <div className="text-sm text-text-muted">Loading…</div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-white/10 bg-bg-panel/70 p-6 backdrop-blur">
        <div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
          {error}
        </div>
      </section>
    )
  }

  if (!task) {
    return (
      <section className="rounded-2xl border border-white/10 bg-bg-panel/70 p-6 backdrop-blur">
        <div className="text-sm text-text-muted">Select a task to see details.</div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-bg-panel/70 p-6 backdrop-blur">
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
        <button
          type="button"
          className={[
            'rounded-md px-3 py-1.5 text-sm',
            tab === 'overview' ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text-main',
          ].join(' ')}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          className={[
            'rounded-md px-3 py-1.5 text-sm',
            tab === 'events' ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text-main',
          ].join(' ')}
          onClick={() => setTab('events')}
        >
          Events
        </button>
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
              <div className="mt-4 rounded-lg border border-white/10 bg-bg-panelHover p-3 text-sm text-text-muted">
                {task.description}
              </div>
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

      {tab === 'events' && (
        <div>
          {events.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">
              No events yet.
            </div>
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
    </section>
  )
}

export default TaskDetail

