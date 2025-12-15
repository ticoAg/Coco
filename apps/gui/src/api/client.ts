/**
 * AgentMesh API Client
 * Handles all HTTP communication with the Orchestrator backend
 */

import type {
  Task,
  TaskListResponse,
  TaskDetailResponse,
  TaskEventsResponse,
  CreateTaskRequest,
  GateDecisionRequest,
  ClusterStatus,
  ApiError,
} from '../types/task';

// Configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_PREFIX = '/api';

// Custom error class for API errors
export class ApiClientError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.code = error.code;
    this.details = error.details;
  }
}

// Generic fetch wrapper with error handling
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${API_PREFIX}${endpoint}`;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const config: RequestInit = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      let errorData: ApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          code: 'UNKNOWN_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
      throw new ApiClientError(errorData);
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }

    // Network or other errors
    throw new ApiClientError({
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Network request failed',
    });
  }
}

// ============ Tasks API ============

/**
 * Get list of all tasks
 */
export async function getTasks(): Promise<TaskListResponse> {
  return request<TaskListResponse>('/tasks');
}

/**
 * Get task details by ID
 */
export async function getTask(taskId: string): Promise<TaskDetailResponse> {
  return request<TaskDetailResponse>(`/tasks/${taskId}`);
}

/**
 * Create a new task
 */
export async function createTask(data: CreateTaskRequest): Promise<Task> {
  return request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Delete a task
 */
export async function deleteTask(taskId: string): Promise<void> {
  await request<void>(`/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

// ============ Events API ============

/**
 * Get events for a task
 */
export async function getTaskEvents(
  taskId: string,
  options?: {
    cursor?: string;
    limit?: number;
    type?: string;
  }
): Promise<TaskEventsResponse> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.type) params.set('type', options.type);

  const query = params.toString();
  const endpoint = `/tasks/${taskId}/events${query ? `?${query}` : ''}`;

  return request<TaskEventsResponse>(endpoint);
}

// ============ Gates API ============

/**
 * Submit a decision for a gate
 */
export async function submitGateDecision(
  taskId: string,
  gateId: string,
  decision: GateDecisionRequest
): Promise<void> {
  await request<void>(`/tasks/${taskId}/gates/${gateId}/decision`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

// ============ Turn API ============

/**
 * Trigger a turn for a task
 */
export async function triggerTurn(
  taskId: string,
  data: {
    agentInstanceId: string;
    input: string;
    attachments?: string[];
  }
): Promise<void> {
  await request<void>(`/tasks/${taskId}/turn`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============ Cluster Status API ============

/**
 * Get cluster status
 */
export async function getClusterStatus(): Promise<ClusterStatus> {
  return request<ClusterStatus>('/status');
}

// ============ SSE Stream for Real-time Updates ============

export type StreamEventType =
  | 'task.updated'
  | 'gate.created'
  | 'artifact.updated'
  | 'agent.state_changed';

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
}

export type StreamEventHandler = (event: StreamEvent) => void;
export type StreamErrorHandler = (error: Error) => void;

/**
 * Create an SSE connection for real-time updates
 * Returns a cleanup function to close the connection
 */
export function createEventStream(
  onEvent: StreamEventHandler,
  onError?: StreamErrorHandler
): () => void {
  const url = `${API_BASE_URL}${API_PREFIX}/stream`;
  let eventSource: EventSource | null = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000;

  function connect() {
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      console.log('[SSE] Connected to event stream');
      reconnectAttempts = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;
        onEvent(data);
      } catch (error) {
        console.error('[SSE] Failed to parse event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);
      eventSource?.close();

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`[SSE] Reconnecting (${reconnectAttempts}/${maxReconnectAttempts})...`);
        setTimeout(connect, reconnectDelay);
      } else {
        onError?.(new Error('SSE connection failed after maximum reconnection attempts'));
      }
    };
  }

  connect();

  // Return cleanup function
  return () => {
    console.log('[SSE] Closing connection');
    eventSource?.close();
    eventSource = null;
  };
}

// ============ Polling Alternative ============

/**
 * Create a polling mechanism for environments where SSE is not available
 * Returns a cleanup function to stop polling
 */
export function createPolling(
  _taskId: string | null,
  onUpdate: (tasks: Task[]) => void,
  onError?: (error: Error) => void,
  interval: number = 5000
): () => void {
  let isActive = true;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  async function poll() {
    if (!isActive) return;

    try {
      const response = await getTasks();
      onUpdate(response.tasks);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Polling failed'));
    }

    if (isActive) {
      timeoutId = setTimeout(poll, interval);
    }
  }

  // Start polling
  poll();

  // Return cleanup function
  return () => {
    isActive = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
}

// ============ Export API client object ============

export const apiClient = {
  // Tasks
  getTasks,
  getTask,
  createTask,
  deleteTask,
  // Events
  getTaskEvents,
  // Gates
  submitGateDecision,
  // Turn
  triggerTurn,
  // Status
  getClusterStatus,
  // Streaming
  createEventStream,
  createPolling,
};

export default apiClient;
