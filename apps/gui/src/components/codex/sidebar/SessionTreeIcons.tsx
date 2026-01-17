import { Box, Command, File, FileText, Folder, FolderOpen, GitBranch, Terminal } from 'lucide-react';
import type { TreeNodeType } from '../../../types/sidebar';

interface SessionTreeIconProps {
	type: TreeNodeType;
	isExpanded?: boolean;
	className?: string;
}

const ICON_SIZE = 14;

export function SessionTreeIcon({ type, isExpanded, className }: SessionTreeIconProps) {
	const iconProps = { size: ICON_SIZE, className };

	switch (type) {
		case 'repo':
			return <GitBranch {...iconProps} />;
		case 'task':
			return <Box {...iconProps} />;
		case 'orchestrator':
			return <Command {...iconProps} />;
		case 'worker':
			return <Terminal {...iconProps} />;
		case 'folder':
			return isExpanded ? <FolderOpen {...iconProps} /> : <Folder {...iconProps} />;
		case 'file':
			return <FileText {...iconProps} />;
		default:
			return <File {...iconProps} />;
	}
}

export function getStatusColor(status?: string): string {
	switch (status) {
		case 'working':
		case 'running':
		case 'active':
			return 'text-primary';
		case 'completed':
		case 'done':
			return 'text-status-success';
		case 'failed':
		case 'error':
			return 'text-status-error';
		case 'blocked':
		case 'input-required':
			return 'text-status-warning';
		default:
			return 'text-text-muted';
	}
}
