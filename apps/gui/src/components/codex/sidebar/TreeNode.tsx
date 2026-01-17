import { ChevronRight } from 'lucide-react';
import type { TreeNodeData } from '../../../types/sidebar';
import { SessionTreeIcon, getStatusColor } from './SessionTreeIcons';
import { SessionRunningIndicator } from '../SessionRunningIndicator';

interface TreeNodeProps {
	node: TreeNodeData;
	depth: number;
	isExpanded: boolean;
	isSelected: boolean;
	onSelect: (node: TreeNodeData) => void;
	onToggleExpand: (nodeId: string) => void;
	renderChildren?: () => React.ReactNode;
}

export function TreeNode({
	node,
	depth,
	isExpanded,
	isSelected,
	onSelect,
	onToggleExpand,
	renderChildren,
}: TreeNodeProps) {
	const indentPx = 8 + depth * 12;
	const hasChildren = Array.isArray(node.children);

	const handleClick = () => {
		onSelect(node);
	};

	const handleChevronClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		onToggleExpand(node.id);
	};

	return (
		<div>
			<div
				className={`flex items-center gap-1 rounded-lg px-1 py-0.5 cursor-pointer transition-colors ${
					isSelected ? 'bg-primary/20' : 'hover:bg-white/5'
				}`}
				style={{ paddingLeft: indentPx }}
				onClick={handleClick}
			>
				{/* Expand/Collapse chevron */}
				<button
					type="button"
					className={`flex h-4 w-4 items-center justify-center shrink-0 ${hasChildren ? 'opacity-100' : 'opacity-0'}`}
					onClick={handleChevronClick}
					disabled={!hasChildren}
				>
					<ChevronRight
						size={12}
						className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
					/>
				</button>

				{/* Icon */}
				<SessionTreeIcon
					type={node.type}
					isExpanded={isExpanded}
					className={getStatusColor(node.status)}
				/>

				{/* Running indicator */}
				{node.isActive ? <SessionRunningIndicator /> : null}

				{/* Label */}
				<span className="truncate text-[11px] text-text-main flex-1 min-w-0">{node.label}</span>

				{/* Status badge */}
				{node.status && node.type !== 'repo' ? (
					<span className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${getStatusColor(node.status)} bg-white/5`}>
						{node.status}
					</span>
				) : null}
			</div>

			{/* Children */}
			{isExpanded && renderChildren ? <div>{renderChildren()}</div> : null}
		</div>
	);
}
