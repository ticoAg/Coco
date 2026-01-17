import { ChevronLeft, Plus, RefreshCw } from 'lucide-react';
import { useCallback } from 'react';
import type { TreeNodeData } from '../../../types/sidebar';
import { TreeNode } from './TreeNode';
import { SIDEBAR_WIDTH_PX, SIDEBAR_EXPANDED_WIDTH_PX } from '../styles/menu-styles';

interface SessionTreeSidebarProps {
	isExpanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
	workspaceLabel: string;
	treeData: TreeNodeData[];
	expandedNodes: Set<string>;
	selectedNodeId: string | null;
	onToggleExpand: (nodeId: string) => void;
	onSelectNode: (node: TreeNodeData) => void;
	onCreateNewSession?: () => void;
	onRefresh?: () => void;
	loading?: boolean;
	error?: string | null;
}

export function SessionTreeSidebar({
	isExpanded,
	onExpandedChange,
	workspaceLabel,
	treeData,
	expandedNodes,
	selectedNodeId,
	onToggleExpand,
	onSelectNode,
	onCreateNewSession,
	onRefresh,
	loading,
	error,
}: SessionTreeSidebarProps) {
	const handleNodeSelect = useCallback(
		(node: TreeNodeData) => {
			onSelectNode(node);
		},
		[onSelectNode]
	);

	const renderNode = useCallback(
		(node: TreeNodeData, depth: number): React.ReactNode => {
			const isNodeExpanded = expandedNodes.has(node.id);
			const isNodeSelected = selectedNodeId === node.id;

			return (
				<TreeNode
					key={node.id}
					node={node}
					depth={depth}
					isExpanded={isNodeExpanded}
					isSelected={isNodeSelected}
					onSelect={handleNodeSelect}
					onToggleExpand={onToggleExpand}
					renderChildren={
						node.children ? () => node.children!.map((child) => renderNode(child, depth + 1)) : undefined
					}
				/>
			);
		},
		[expandedNodes, selectedNodeId, handleNodeSelect, onToggleExpand]
	);

	const sidebarWidth = isExpanded ? SIDEBAR_EXPANDED_WIDTH_PX : SIDEBAR_WIDTH_PX;

	// Collapsed view
	if (!isExpanded) {
		return (
			<div className="relative shrink-0" style={{ width: sidebarWidth }}>
				<aside className="flex h-full w-full flex-col items-center gap-4 border-r border-white/10 bg-bg-panel/40 pt-6 pb-0.5">
					{/* Codex icon */}
					<button
						type="button"
						className="flex items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-text-main"
						title="Expand sidebar"
						style={{ width: SIDEBAR_WIDTH_PX * 0.7, height: SIDEBAR_WIDTH_PX * 0.7 }}
						onClick={() => onExpandedChange(true)}
					>
						<span style={{ fontSize: SIDEBAR_WIDTH_PX * 0.4, lineHeight: 1 }}>✷</span>
					</button>

					{/* New session button */}
					{onCreateNewSession ? (
						<button
							type="button"
							className="flex items-center justify-center rounded-lg border border-white/10 bg-bg-panelHover text-text-main hover:border-white/20"
							onClick={onCreateNewSession}
							title="New session"
							style={{ width: SIDEBAR_WIDTH_PX * 0.7, height: SIDEBAR_WIDTH_PX * 0.7 }}
						>
							<Plus size={SIDEBAR_WIDTH_PX * 0.4} />
						</button>
					) : null}
				</aside>
			</div>
		);
	}

	// Expanded view
	return (
		<div className="relative shrink-0" style={{ width: sidebarWidth }}>
			<aside className="flex h-full w-full flex-col border-r border-white/10 bg-bg-panel/40">
				{/* Header */}
				<div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
					<div className="flex items-center gap-2 min-w-0">
						<span style={{ fontSize: 14 }}>✷</span>
						<span className="truncate text-xs font-semibold text-text-main">{workspaceLabel || 'Workspace'}</span>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						{onRefresh ? (
							<button
								type="button"
								className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10"
								onClick={onRefresh}
								title="Refresh"
							>
								<RefreshCw size={12} />
							</button>
						) : null}
						<button
							type="button"
							className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10"
							onClick={() => onExpandedChange(false)}
							title="Collapse sidebar"
						>
							<ChevronLeft size={14} />
						</button>
					</div>
				</div>

				{/* Tree content */}
				<div className="flex-1 min-h-0 overflow-y-auto px-1 py-2">
					{error ? <div className="px-2 py-1 text-[10px] text-status-error">{error}</div> : null}
					{!error && loading ? <div className="px-2 py-1 text-[10px] text-text-dim">Loading…</div> : null}
					{treeData.map((node) => renderNode(node, 0))}
				</div>

				{/* Footer with new session button */}
				{onCreateNewSession ? (
					<div className="border-t border-white/10 p-2">
						<button
							type="button"
							className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2 text-xs text-text-main hover:border-white/20"
							onClick={onCreateNewSession}
						>
							<Plus size={14} />
							<span>New Session</span>
						</button>
					</div>
				) : null}
			</aside>
		</div>
	);
}
