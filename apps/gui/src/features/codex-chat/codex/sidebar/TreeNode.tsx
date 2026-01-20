import { Archive, ChevronRight } from 'lucide-react';
import type { TreeNodeData } from '@/types/sidebar';
import { SessionTreeIcon, getStatusColor } from './SessionTreeIcons';
import { SessionRunningIndicator } from '../SessionRunningIndicator';

interface TreeNodeProps {
	node: TreeNodeData;
	depth: number;
	isExpanded: boolean;
	isSelected: boolean;
	onSelect: (node: TreeNodeData) => void;
	onToggleExpand: (nodeId: string) => void;
	onContextMenu?: (node: TreeNodeData, event: React.MouseEvent) => void;
	renderChildren?: () => React.ReactNode;
	onAction?: (node: TreeNodeData, actionId: string) => void;
}

export function TreeNode({ node, depth, isExpanded, isSelected, onSelect, onToggleExpand, onContextMenu, renderChildren, onAction }: TreeNodeProps) {
	const indentPx = 8 + depth * 12;
	const hasChildren = Array.isArray(node.children);

	const handleClick = () => {
		onSelect(node);
	};

	const handleChevronClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		onToggleExpand(node.id);
	};

	const showInteractionCount = node.interactionCount != null && (node.type === 'task' || node.type === 'orchestrator' || node.type === 'worker');

	const labelTitle = node.label;
	const wtLabel = node.metadata?.wtLabel ?? null;
	const showWtLabel = Boolean(wtLabel && (node.type === 'task' || node.type === 'orchestrator' || node.type === 'worker'));
	const action = node.actions?.[0] ?? null;

	return (
		<div>
			<div
				className={`group flex items-center gap-1 rounded-lg px-1 py-0.5 cursor-pointer transition-colors ${isSelected ? 'bg-primary/20' : 'hover:bg-white/5'}`}
				style={{ paddingLeft: indentPx }}
				onClick={handleClick}
				onContextMenu={(event) => {
					if (!onContextMenu) return;
					onContextMenu(node, event);
				}}
			>
				{/* Expand/Collapse chevron */}
				<button
					type="button"
					className={`flex h-4 w-4 items-center justify-center shrink-0 ${hasChildren ? 'opacity-100' : 'opacity-0'}`}
					onClick={handleChevronClick}
					disabled={!hasChildren}
				>
					<ChevronRight size={12} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
				</button>

				{/* Icon */}
				{showInteractionCount ? (
					<div
						className={[
							'flex h-4 min-w-[14px] items-center justify-center rounded-full bg-white/10 px-1 text-[9px] font-semibold',
							getStatusColor(node.status),
						].join(' ')}
					>
						{node.interactionCount}
					</div>
				) : (
					<SessionTreeIcon type={node.type} isExpanded={isExpanded} className={getStatusColor(node.status)} />
				)}

				{/* Running indicator */}
				{node.isActive ? <SessionRunningIndicator /> : null}

				{/* Label */}
				<span className="truncate text-[11px] text-text-main flex-1 min-w-0" title={labelTitle}>
					{node.label}
				</span>

				{showWtLabel ? (
					<span className="ml-1 min-w-0 max-w-[120px] truncate rounded bg-white/5 px-1 py-0.5 text-[9px] text-text-muted" title={wtLabel ?? undefined}>
						{wtLabel}
					</span>
				) : null}

				{/* Hover action */}
				{action ? (
					<button
						type="button"
						className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-text-main"
						title={action.title}
						onClick={(event) => {
							event.stopPropagation();
							onAction?.(node, action.id);
						}}
					>
						<Archive size={12} />
					</button>
				) : null}

				{/* Status badge */}
				{node.status && node.type !== 'repo' ? (
					<span className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${getStatusColor(node.status)} bg-white/5`}>{node.status}</span>
				) : null}
			</div>

			{/* Children */}
			{isExpanded && renderChildren ? <div>{renderChildren()}</div> : null}
		</div>
	);
}
