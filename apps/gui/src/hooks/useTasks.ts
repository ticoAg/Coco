/**
 * useTasks Hook
 * Custom hook for managing task data with real-time updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Task,
  TaskEvent,
  ClusterStatus,
  CreateTaskRequest,
  GateDecisionRequest,
} from '../types/task';
import {
  apiClient,
  ApiClientError,
  createEventStream,
  createPolling,
} from '../api/client';

// ============ useTasks Hook ============

interface UseTasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
}

interface UseTasksReturn extends UseTasksState {
  refresh: () => Promise<void>;
  createTask: (data: CreateTaskRequest) => Promise<Task | null>;
  deleteTask: (taskId: string) => Promise<boolean>;
}

export function useTasks(enablePolling: boolean = true): UseTasksReturn {
  const [state, setState] = useState<UseTasksState>({
    tasks: [],
    loading: true,
    error: null,
  });

  const cleanupRef = useRef<(() => void) | null>(null);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      const response = await apiClient.getTasks();
      setState((prev) => ({
        ...prev,
        tasks: response.tasks,
        loading: false,
        error: null,
      }));
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : 'Failed to fetch tasks';
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
    }
  }, []);

  // Refresh tasks
  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    await fetchTasks();
  }, [fetchTasks]);

  // Create task
  const createTask = useCallback(async (data: CreateTaskRequest): Promise<Task | null> => {
    try {
      const task = await apiClient.createTask(data);
      // Refresh task list after creation
      await fetchTasks();
      return task;
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : 'Failed to create task';
      setState((prev) => ({ ...prev, error: message }));
      return null;
    }
  }, [fetchTasks]);

  // Delete task
  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      await apiClient.deleteTask(taskId);
      // Refresh task list after deletion
      await fetchTasks();
      return true;
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : 'Failed to delete task';
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }
  }, [fetchTasks]);

  // Initial fetch and polling setup
  useEffect(() => {
    fetchTasks();

    if (enablePolling) {
      // Try SSE first, fall back to polling
      try {
        cleanupRef.current = createEventStream(
          (event) => {
            if (event.type === 'task.updated') {
              fetchTasks();
            }
          },
          () => {
            // SSE failed, switch to polling
            console.log('[useTasks] SSE failed, switching to polling');
            cleanupRef.current = createPolling(
              null,
              (tasks) => {
                setState((prev) => ({
                  ...prev,
                  tasks,
                  loading: false,
                }));
              },
              (error) => {
                console.error('[useTasks] Polling error:', error);
              },
              5000
            );
          }
        );
      } catch {
        // SSE not supported, use polling
        cleanupRef.current = createPolling(
          null,
          (tasks) => {
            setState((prev) => ({
              ...prev,
              tasks,
              loading: false,
            }));
          },
          undefined,
          5000
        );
      }
    }

    return () => {
      cleanupRef.current?.();
    };
  }, [fetchTasks, enablePolling]);

  return {
    ...state,
    refresh,
    createTask,
    deleteTask,
  };
}

// ============ useTaskDetail Hook ============

interface UseTaskDetailState {
  task: Task | null;
  events: TaskEvent[];
  loading: boolean;
  error: string | null;
}

interface UseTaskDetailReturn extends UseTaskDetailState {
  refresh: () => Promise<void>;
  loadMoreEvents: () => Promise<void>;
  hasMoreEvents: boolean;
  submitGateDecision: (gateId: string, decision: GateDecisionRequest) => Promise<boolean>;
}

export function useTaskDetail(taskId: string | null): UseTaskDetailReturn {
  const [state, setState] = useState<UseTaskDetailState>({
    task: null,
    events: [],
    loading: true,
    error: null,
  });
  const [hasMoreEvents, setHasMoreEvents] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);

  // Fetch task detail
  const fetchTask = useCallback(async () => {
    if (!taskId) {
      setState({
        task: null,
        events: [],
        loading: false,
        error: null,
      });
      return;
    }

    try {
      const response = await apiClient.getTask(taskId);
      setState((prev) => ({
        ...prev,
        task: response.task,
        events: response.events || [],
        loading: false,
        error: null,
      }));
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : 'Failed to fetch task details';
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
    }
  }, [taskId]);

  // Fetch events
  const fetchEvents = useCallback(async (append: boolean = false) => {
    if (!taskId) return;

    try {
      const response = await apiClient.getTaskEvents(taskId, {
        cursor: append ? cursorRef.current : undefined,
        limit: 50,
      });

      cursorRef.current = response.cursor;
      setHasMoreEvents(response.hasMore);

      setState((prev) => ({
        ...prev,
        events: append ? [...prev.events, ...response.events] : response.events,
      }));
    } catch (error) {
      console.error('Failed to fetch events:', error);
    }
  }, [taskId]);

  // Refresh
  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    cursorRef.current = undefined;
    await fetchTask();
    await fetchEvents(false);
  }, [fetchTask, fetchEvents]);

  // Load more events
  const loadMoreEvents = useCallback(async () => {
    await fetchEvents(true);
  }, [fetchEvents]);

  // Submit gate decision
  const submitGateDecision = useCallback(
    async (gateId: string, decision: GateDecisionRequest): Promise<boolean> => {
      if (!taskId) return false;

      try {
        await apiClient.submitGateDecision(taskId, gateId, decision);
        await refresh();
        return true;
      } catch (error) {
        const message =
          error instanceof ApiClientError
            ? error.message
            : 'Failed to submit gate decision';
        setState((prev) => ({ ...prev, error: message }));
        return false;
      }
    },
    [taskId, refresh]
  );

  // Initial fetch
  useEffect(() => {
    fetchTask();
    fetchEvents(false);
  }, [fetchTask, fetchEvents]);

  return {
    ...state,
    refresh,
    loadMoreEvents,
    hasMoreEvents,
    submitGateDecision,
  };
}

// ============ useClusterStatus Hook ============

interface UseClusterStatusReturn {
  status: ClusterStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useClusterStatus(pollInterval: number = 10000): UseClusterStatusReturn {
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiClient.getClusterStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Failed to fetch cluster status';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();

    const intervalId = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(intervalId);
  }, [fetchStatus, pollInterval]);

  return { status, loading, error, refresh };
}

// ============ Export ============

export default {
  useTasks,
  useTaskDetail,
  useClusterStatus,
};
