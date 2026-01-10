import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import type { ClusterStatus, CreateTaskRequest, Task, TaskEvent } from '../types/task'

// ============ useTasks ============

interface UseTasksState {
  tasks: Task[]
  loading: boolean
  error: string | null
}

interface UseTasksReturn extends UseTasksState {
  refresh: () => Promise<void>
  createTask: (data: CreateTaskRequest) => Promise<string | null>
}

export function useTasks(enablePolling: boolean = true): UseTasksReturn {
  const [state, setState] = useState<UseTasksState>({
    tasks: [],
    loading: true,
    error: null,
  })

  const fetchTasks = useCallback(async () => {
    try {
      const tasks = await apiClient.listTasks()
      setState({ tasks, loading: false, error: null })
    } catch (err) {
      setState({
        tasks: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load tasks',
      })
    }
  }, [])

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    await fetchTasks()
  }, [fetchTasks])

  const createTask = useCallback(async (data: CreateTaskRequest): Promise<string | null> => {
    try {
      const res = await apiClient.createTask(data)
      await fetchTasks()
      return res.id
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to create task',
      }))
      return null
    }
  }, [fetchTasks])

  useEffect(() => {
    fetchTasks()
    if (!enablePolling) return

    const timer = setInterval(fetchTasks, 5000)
    return () => clearInterval(timer)
  }, [enablePolling, fetchTasks])

  return { ...state, refresh, createTask }
}

// ============ useTaskDetail ============

interface UseTaskDetailState {
  task: Task | null
  events: TaskEvent[]
  loading: boolean
  error: string | null
}

interface UseTaskDetailReturn extends UseTaskDetailState {
  refresh: () => Promise<void>
  loadMoreEvents: () => Promise<void>
  hasMoreEvents: boolean
}

export function useTaskDetail(taskId: string | null): UseTaskDetailReturn {
  const [state, setState] = useState<UseTaskDetailState>({
    task: null,
    events: [],
    loading: true,
    error: null,
  })
  const [hasMoreEvents, setHasMoreEvents] = useState(false)
  const offsetRef = useRef(0)

  const fetchTask = useCallback(async () => {
    if (!taskId) {
      setState({ task: null, events: [], loading: false, error: null })
      return
    }

    try {
      const task = await apiClient.getTask(taskId)
      setState((prev) => ({ ...prev, task, loading: false, error: null }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load task',
      }))
    }
  }, [taskId])

  const fetchEvents = useCallback(async (append: boolean) => {
    if (!taskId) return
    const limit = 50
    const offset = append ? offsetRef.current : 0

    try {
      const events = await apiClient.getTaskEvents(taskId, { limit, offset })
      offsetRef.current = offset + events.length
      setHasMoreEvents(events.length >= limit)
      setState((prev) => ({ ...prev, events: append ? [...prev.events, ...events] : events }))
    } catch (err) {
      // keep task visible; just log events failures
      console.error('Failed to fetch events:', err)
    }
  }, [taskId])

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    offsetRef.current = 0
    await fetchTask()
    await fetchEvents(false)
  }, [fetchTask, fetchEvents])

  const loadMoreEvents = useCallback(async () => {
    await fetchEvents(true)
  }, [fetchEvents])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { ...state, refresh, loadMoreEvents, hasMoreEvents }
}

// ============ useClusterStatus ============

interface UseClusterStatusReturn {
  status: ClusterStatus | null
  loading: boolean
  error: string | null
}

export function useClusterStatus(pollInterval: number = 10000): UseClusterStatusReturn {
  const [status, setStatus] = useState<ClusterStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiClient.getClusterStatus()
      setStatus(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, pollInterval)
    return () => clearInterval(timer)
  }, [fetchStatus, pollInterval])

  return { status, loading, error }
}

