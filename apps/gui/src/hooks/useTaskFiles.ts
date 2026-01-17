import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { TaskDirectoryEntry } from '../types/sidebar';

const getErrorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

interface UseTaskFilesState {
	entries: TaskDirectoryEntry[];
	loading: boolean;
	error: string | null;
}

interface UseTaskFilesReturn extends UseTaskFilesState {
	refresh: () => Promise<void>;
}

export function useTaskFiles(taskId: string | null, relativePath: string = ''): UseTaskFilesReturn {
	const [state, setState] = useState<UseTaskFilesState>({
		entries: [],
		loading: true,
		error: null,
	});

	const refresh = useCallback(async () => {
		if (!taskId) {
			setState({ entries: [], loading: false, error: null });
			return;
		}

		setState((prev) => ({ ...prev, loading: true }));
		try {
			const entries = await apiClient.taskListDirectory(taskId, relativePath);
			setState({ entries, loading: false, error: null });
		} catch (err) {
			setState({
				entries: [],
				loading: false,
				error: getErrorMessage(err, 'Failed to list directory'),
			});
		}
	}, [taskId, relativePath]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { ...state, refresh };
}
