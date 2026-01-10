import { invoke } from '@tauri-apps/api/core'
import type {
  ClusterStatus,
  CreateTaskRequest,
  CreateTaskResponse,
  Task,
  TaskEvent,
} from '../types/task'

export async function listTasks(): Promise<Task[]> {
  return invoke<Task[]>('list_tasks')
}

export async function getTask(taskId: string): Promise<Task> {
  return invoke<Task>('get_task', { task_id: taskId })
}

export async function getTaskEvents(
  taskId: string,
  options: {
    limit: number
    offset: number
    eventTypePrefix?: string
  }
): Promise<TaskEvent[]> {
  return invoke<TaskEvent[]>('get_task_events', {
    task_id: taskId,
    event_type_prefix: options.eventTypePrefix ?? null,
    limit: options.limit,
    offset: options.offset,
  })
}

export async function createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {
  return invoke<CreateTaskResponse>('create_task', {
    req: {
      title: req.title,
      description: req.description ?? '',
      topology: req.topology,
      roster: req.roster ?? [],
    },
  })
}

export async function getClusterStatus(): Promise<ClusterStatus> {
  return invoke<ClusterStatus>('cluster_status')
}

export const apiClient = {
  listTasks,
  getTask,
  getTaskEvents,
  createTask,
  getClusterStatus,
}

export default apiClient

