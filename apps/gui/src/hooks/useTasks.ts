import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import type {
	ClusterStatus,
	CreateTaskRequest,
	SharedArtifactCategory,
	SharedArtifactContent,
	SharedArtifactSummary,
	SubagentFinalOutput,
	SubagentSessionSummary,
	Task,
	TaskEvent,
} from '../types/task';

const getErrorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

// ============ useTasks ============

interface UseTasksState {
	tasks: Task[];
	loading: boolean;
	error: string | null;
}

interface UseTasksReturn extends UseTasksState {
	refresh: () => Promise<void>;
	createTask: (data: CreateTaskRequest) => Promise<string | null>;
}

export function useTasks(enablePolling: boolean = true): UseTasksReturn {
	const [state, setState] = useState<UseTasksState>({
		tasks: [],
		loading: true,
		error: null,
	});

	const fetchTasks = useCallback(async () => {
		try {
			const tasks = await apiClient.listTasks();
			setState({ tasks, loading: false, error: null });
		} catch (err) {
			setState({
				tasks: [],
				loading: false,
				error: getErrorMessage(err, 'Failed to load tasks'),
			});
		}
	}, []);

	const refresh = useCallback(async () => {
		setState((prev) => ({ ...prev, loading: true }));
		await fetchTasks();
	}, [fetchTasks]);

	const createTask = useCallback(
		async (data: CreateTaskRequest): Promise<string | null> => {
			try {
				const res = await apiClient.createTask(data);
				await fetchTasks();
				return res.id;
			} catch (err) {
				setState((prev) => ({
					...prev,
					error: getErrorMessage(err, 'Failed to create task'),
				}));
				return null;
			}
		},
		[fetchTasks]
	);

	useEffect(() => {
		fetchTasks();
		if (!enablePolling) return;

		const timer = setInterval(fetchTasks, 5000);
		return () => clearInterval(timer);
	}, [enablePolling, fetchTasks]);

	return { ...state, refresh, createTask };
}

// ============ useTaskDetail ============

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
}

export function useTaskDetail(taskId: string | null): UseTaskDetailReturn {
	const [state, setState] = useState<UseTaskDetailState>({
		task: null,
		events: [],
		loading: true,
		error: null,
	});
	const [hasMoreEvents, setHasMoreEvents] = useState(false);
	const offsetRef = useRef(0);

	const fetchTask = useCallback(async () => {
		if (!taskId) {
			setState({ task: null, events: [], loading: false, error: null });
			return;
		}

		try {
			const task = await apiClient.getTask(taskId);
			setState((prev) => ({ ...prev, task, loading: false, error: null }));
		} catch (err) {
			setState((prev) => ({
				...prev,
				loading: false,
				error: getErrorMessage(err, 'Failed to load task'),
			}));
		}
	}, [taskId]);

	const fetchEvents = useCallback(
		async (append: boolean) => {
			if (!taskId) return;
			const limit = 50;
			const offset = append ? offsetRef.current : 0;

			try {
				const events = await apiClient.getTaskEvents(taskId, { limit, offset });
				offsetRef.current = offset + events.length;
				setHasMoreEvents(events.length >= limit);
				setState((prev) => ({
					...prev,
					events: append ? [...prev.events, ...events] : events,
				}));
			} catch (err) {
				// keep task visible; just log events failures
				console.error('Failed to fetch events:', err);
			}
		},
		[taskId]
	);

	const refresh = useCallback(async () => {
		setState((prev) => ({ ...prev, loading: true }));
		offsetRef.current = 0;
		await fetchTask();
		await fetchEvents(false);
	}, [fetchTask, fetchEvents]);

	const loadMoreEvents = useCallback(async () => {
		await fetchEvents(true);
	}, [fetchEvents]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { ...state, refresh, loadMoreEvents, hasMoreEvents };
}

// ============ useClusterStatus ============

interface UseClusterStatusReturn {
	status: ClusterStatus | null;
	loading: boolean;
	error: string | null;
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
			setError(getErrorMessage(err, 'Failed to fetch status'));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchStatus();
		const timer = setInterval(fetchStatus, pollInterval);
		return () => clearInterval(timer);
	}, [fetchStatus, pollInterval]);

	return { status, loading, error };
}

// ============ useSubagentSessions ============

interface UseSubagentSessionsState {
	sessions: SubagentSessionSummary[];
	selectedAgentInstance: string | null;
	finalOutput: SubagentFinalOutput | null;
	runtimeEvents: string[];
	runtimeStderr: string[];
	loading: boolean;
	error: string | null;
}

interface UseSubagentSessionsReturn extends UseSubagentSessionsState {
	refresh: () => Promise<void>;
	selectAgentInstance: (agentInstance: string) => void;
}

export function useSubagentSessions(
	taskId: string | null,
	options?: {
		enabled?: boolean;
		pollIntervalMs?: number;
		eventsTailLimit?: number;
		autoFollow?: boolean;
	}
): UseSubagentSessionsReturn {
	const enabled = options?.enabled ?? true;
	const pollIntervalMs = options?.pollIntervalMs ?? 2000;
	const eventsTailLimit = options?.eventsTailLimit ?? 200;
	const autoFollow = options?.autoFollow ?? false;

	const [state, setState] = useState<UseSubagentSessionsState>({
		sessions: [],
		selectedAgentInstance: null,
		finalOutput: null,
		runtimeEvents: [],
		runtimeStderr: [],
		loading: true,
		error: null,
	});

	const fetchDetails = useCallback(
		async (agentInstance: string) => {
			if (!taskId) return;

			const [finalOutput, runtimeEvents, runtimeStderr] = await Promise.all([
				apiClient.getSubagentFinalOutput(taskId, agentInstance),
				apiClient.tailSubagentEvents(taskId, agentInstance, eventsTailLimit),
				apiClient.tailSubagentStderr(taskId, agentInstance, eventsTailLimit),
			]);

			setState((prev) => ({
				...prev,
				finalOutput,
				runtimeEvents,
				runtimeStderr,
				error: null,
			}));
		},
		[taskId, eventsTailLimit]
	);

	const refresh = useCallback(
		async (options?: { background?: boolean }) => {
			if (!enabled) return;
			if (!taskId) return;

			if (!options?.background) {
				setState((prev) => ({ ...prev, loading: true }));
			}
			try {
				const sessions = await apiClient.listSubagentSessions(taskId);
				const selectedStillValid = state.selectedAgentInstance && sessions.some((s) => s.agentInstance === state.selectedAgentInstance);

				const running = sessions.filter((s) => s.status === 'running');
				const bestRunning = running.sort((a, b) => (b.lastUpdatedAtMs ?? 0) - (a.lastUpdatedAtMs ?? 0))[0]?.agentInstance ?? null;
				const selectedAgentInstance = autoFollow
					? bestRunning ?? (selectedStillValid ? state.selectedAgentInstance : (sessions[0]?.agentInstance ?? null))
					: selectedStillValid
						? state.selectedAgentInstance
						: (sessions[0]?.agentInstance ?? null);

				setState((prev) => ({
					...prev,
					sessions,
					selectedAgentInstance,
					loading: false,
					error: null,
				}));

				if (!selectedAgentInstance) {
					setState((prev) => ({
						...prev,
						finalOutput: null,
						runtimeEvents: [],
						runtimeStderr: [],
					}));
					return;
				}

				await fetchDetails(selectedAgentInstance);
			} catch (err) {
				setState((prev) => ({
					...prev,
					loading: false,
					error: getErrorMessage(err, 'Failed to load subagent sessions'),
				}));
			}
		},
		[enabled, taskId, state.selectedAgentInstance, autoFollow, fetchDetails]
	);

	const selectAgentInstance = useCallback(
		(agentInstance: string) => {
			setState((prev) => ({
				...prev,
				selectedAgentInstance: agentInstance,
				finalOutput: null,
				runtimeEvents: [],
				runtimeStderr: [],
			}));

			fetchDetails(agentInstance).catch(() => {
				// ignore selection details fetch errors; keep last successful state
			});
		},
		[fetchDetails]
	);

	useEffect(() => {
		if (!enabled || !taskId) {
			setState({
				sessions: [],
				selectedAgentInstance: null,
				finalOutput: null,
				runtimeEvents: [],
				runtimeStderr: [],
				loading: false,
				error: null,
			});
			return;
		}

		refresh();
	}, [enabled, taskId, refresh]);

	useEffect(() => {
		if (!enabled || !taskId) return;

		const timer = setInterval(() => {
			refresh({ background: true }).catch(() => {
				// ignore polling errors; keep last successful state
			});
		}, pollIntervalMs);

		return () => clearInterval(timer);
	}, [enabled, taskId, pollIntervalMs, refresh]);

	return { ...state, refresh, selectAgentInstance };
}

// ============ useSharedArtifacts ============

interface UseSharedArtifactsState {
	items: SharedArtifactSummary[];
	selectedPath: string | null;
	content: SharedArtifactContent | null;
	loading: boolean;
	error: string | null;
}

interface UseSharedArtifactsReturn extends UseSharedArtifactsState {
	refresh: () => Promise<void>;
	selectArtifact: (path: string) => void;
}

export function useSharedArtifacts(
	taskId: string | null,
	category: SharedArtifactCategory,
	options?: {
		enabled?: boolean;
		pollIntervalMs?: number;
	}
): UseSharedArtifactsReturn {
	const enabled = options?.enabled ?? true;
	const pollIntervalMs = options?.pollIntervalMs ?? 2000;

	const [state, setState] = useState<UseSharedArtifactsState>({
		items: [],
		selectedPath: null,
		content: null,
		loading: true,
		error: null,
	});

	const fetchContent = useCallback(
		async (path: string) => {
			if (!taskId) return;
			const content = await apiClient.readSharedArtifact(taskId, category, path);
			setState((prev) => ({ ...prev, content, error: null }));
		},
		[taskId, category]
	);

	const refresh = useCallback(
		async (options?: { background?: boolean }) => {
			if (!enabled || !taskId) return;

			if (!options?.background) {
				setState((prev) => ({ ...prev, loading: true }));
			}
			try {
				const items = await apiClient.listSharedArtifacts(taskId, category);
				const selectedStillValid = state.selectedPath && items.some((item) => item.path === state.selectedPath);
				const selectedPath = selectedStillValid ? state.selectedPath : (items[0]?.path ?? null);

				setState((prev) => ({
					...prev,
					items,
					selectedPath,
					loading: false,
					error: null,
				}));

				if (!selectedPath) {
					setState((prev) => ({ ...prev, content: null }));
					return;
				}

				await fetchContent(selectedPath);
			} catch (err) {
				setState((prev) => ({
					...prev,
					loading: false,
					error: getErrorMessage(err, 'Failed to load artifacts'),
				}));
			}
		},
		[enabled, taskId, category, state.selectedPath, fetchContent]
	);

	const selectArtifact = useCallback(
		(path: string) => {
			setState((prev) => ({
				...prev,
				selectedPath: path,
				content: null,
			}));
			fetchContent(path).catch(() => {
				// ignore selection errors; keep last successful state
			});
		},
		[fetchContent]
	);

	useEffect(() => {
		if (!enabled || !taskId) {
			setState({
				items: [],
				selectedPath: null,
				content: null,
				loading: false,
				error: null,
			});
			return;
		}

		refresh();
	}, [enabled, taskId, category, refresh]);

	useEffect(() => {
		if (!enabled || !taskId) return;

		const timer = setInterval(() => {
			refresh({ background: true }).catch(() => {
				// ignore polling errors; keep last successful state
			});
		}, pollIntervalMs);

		return () => clearInterval(timer);
	}, [enabled, taskId, category, pollIntervalMs, refresh]);

	return { ...state, refresh, selectArtifact };
}
