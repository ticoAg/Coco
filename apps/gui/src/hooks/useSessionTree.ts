import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task, SubagentSessionSummary } from '../types/task';
import type { TreeNodeData } from '../types/sidebar';

interface UseSessionTreeOptions {
	tasks: Task[];
	subagentsByTask: Map<string, SubagentSessionSummary[]>;
	workspaceRoot: string;
}

interface UseSessionTreeReturn {
	treeData: TreeNodeData[];
	expandedNodes: Set<string>;
	selectedNodeId: string | null;
	toggleNodeExpand: (nodeId: string) => void;
	selectNode: (nodeId: string) => void;
	collapseAll: () => void;
	expandAll: () => void;
}

function buildTaskChildren(task: Task, subagents: SubagentSessionSummary[]): TreeNodeData[] {
	const children: TreeNodeData[] = [];

	// Group subagents by role-like patterns
	// For now, treat all as under a single orchestrator node
	// In future: parse agent names to distinguish orchestrator vs workers

	const orchestratorNode: TreeNodeData = {
		id: `task-${task.id}-orchestrator`,
		type: 'orchestrator',
		label: 'orchestrator',
		isActive: subagents.some((s) => s.status === 'running'),
		children: subagents.map((subagent) => ({
			id: `task-${task.id}-worker-${subagent.agentInstance}`,
			type: 'worker' as const,
			label: subagent.agentInstance,
			isActive: subagent.status === 'running',
			status: subagent.status,
			metadata: {
				taskId: task.id,
				agentInstance: subagent.agentInstance,
			},
		})),
		metadata: {
			taskId: task.id,
		},
	};

	if (subagents.length > 0) {
		children.push(orchestratorNode);
	}

	// Add files node
	children.push({
		id: `task-${task.id}-files`,
		type: 'folder',
		label: 'files',
		metadata: {
			taskId: task.id,
			path: '',
		},
	});

	return children;
}

function buildTreeData(options: UseSessionTreeOptions): TreeNodeData[] {
	const repoName = options.workspaceRoot.split('/').pop() || 'Repository';

	const taskNodes: TreeNodeData[] = options.tasks.map((task) => {
		const subagents = options.subagentsByTask.get(task.id) || [];
		return {
			id: `task-${task.id}`,
			type: 'task' as const,
			label: task.title || task.id,
			isActive: task.state === 'working',
			status: task.state,
			children: buildTaskChildren(task, subagents),
			metadata: {
				taskId: task.id,
			},
		};
	});

	return [
		{
			id: 'root',
			type: 'repo',
			label: repoName,
			isExpanded: true,
			children: taskNodes,
		},
	];
}

function collectAllNodeIds(nodes: TreeNodeData[]): string[] {
	const ids: string[] = [];
	const traverse = (nodeList: TreeNodeData[]) => {
		for (const node of nodeList) {
			ids.push(node.id);
			if (node.children) {
				traverse(node.children);
			}
		}
	};
	traverse(nodes);
	return ids;
}

export function useSessionTree(options: UseSessionTreeOptions): UseSessionTreeReturn {
	const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']));
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

	const treeData = useMemo(() => buildTreeData(options), [options]);

	const toggleNodeExpand = useCallback((nodeId: string) => {
		setExpandedNodes((prev) => {
			const next = new Set(prev);
			if (next.has(nodeId)) {
				next.delete(nodeId);
			} else {
				next.add(nodeId);
			}
			return next;
		});
	}, []);

	const selectNode = useCallback((nodeId: string) => {
		setSelectedNodeId(nodeId);
	}, []);

	const collapseAll = useCallback(() => {
		setExpandedNodes(new Set(['root']));
	}, []);

	const expandAll = useCallback(() => {
		const allIds = collectAllNodeIds(treeData);
		setExpandedNodes(new Set(allIds));
	}, [treeData]);

	// Auto-expand root on initial load
	useEffect(() => {
		if (!expandedNodes.has('root')) {
			setExpandedNodes((prev) => new Set([...prev, 'root']));
		}
	}, [expandedNodes]);

	return {
		treeData,
		expandedNodes,
		selectedNodeId,
		toggleNodeExpand,
		selectNode,
		collapseAll,
		expandAll,
	};
}
