import { useCallback, useMemo, useState } from 'react'
import './index.css'

import { TaskDetail } from './components/TaskDetail'
import { TaskList } from './components/TaskList'
import { NewTaskModal } from './components/NewTaskModal'
import { useClusterStatus, useTaskDetail, useTasks } from './hooks/useTasks'
import type { CreateTaskRequest, Task } from './types/task'

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
  )
}

type RecentEventType = 'info' | 'warning' | 'error' | 'success'

interface RecentEvent {
  time: string
  message: string
  type: RecentEventType
}

function RecentEventsPanel({ tasks }: { tasks: Task[] }) {
  const recentEvents = useMemo<RecentEvent[]>(() => {
    return tasks.slice(0, 5).map((task) => {
      const time = new Date(task.updatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
      let message = `Task "${task.title}"`
      let type: RecentEventType = 'info'

      switch (task.state) {
        case 'working':
          message += ' is running'
          type = 'info'
          break
        case 'input-required':
          message += ' is blocked'
          type = 'warning'
          break
        case 'completed':
          message += ' completed'
          type = 'success'
          break
        case 'failed':
          message += ' failed'
          type = 'error'
          break
        default:
          message += ` (${task.state})`
      }

      return { time, message, type }
    })
  }, [tasks])

  const color = (type: RecentEventType) => {
    switch (type) {
      case 'success':
        return 'text-status-success'
      case 'warning':
        return 'text-status-warning'
      case 'error':
        return 'text-status-error'
      default:
        return 'text-primary'
    }
  }

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
  )
}

export default function App() {
  const enableTaskAuthoring = import.meta.env.VITE_AGENTMESH_ENABLE_TASK_AUTHORING === '1'

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false)
  const [isCreatingTask, setIsCreatingTask] = useState(false)

  const { tasks, loading, error, refresh, createTask } = useTasks(true)
  const { task, events, loading: taskLoading, error: taskError, hasMoreEvents, loadMoreEvents } =
    useTaskDetail(selectedTaskId)
  const { status: clusterStatus } = useClusterStatus(10000)

  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId)
  }, [])

  const handleCreateTask = useCallback(async (data: CreateTaskRequest) => {
    setIsCreatingTask(true)
    try {
      const newId = await createTask(data)
      if (newId) setSelectedTaskId(newId)
    } finally {
      setIsCreatingTask(false)
    }
  }, [createTask])

  return (
    <div className="min-h-full bg-bg-app p-8 text-text-main">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <h1 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-3xl font-bold text-transparent">
            AgentMesh
          </h1>
          <p className="mt-1 text-sm text-text-muted">Orchestrate your coding swarm.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-white/10 bg-bg-panelHover px-4 py-2 text-sm hover:border-white/20"
            onClick={refresh}
          >
            Refresh
          </button>
          {enableTaskAuthoring ? (
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
              onClick={() => setIsNewTaskModalOpen(true)}
            >
              + New Task
            </button>
          ) : null}
        </div>
      </header>

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
        <NewTaskModal
          isOpen={isNewTaskModalOpen}
          onClose={() => setIsNewTaskModalOpen(false)}
          onSubmit={handleCreateTask}
          loading={isCreatingTask}
        />
      ) : null}
    </div>
  )
}
