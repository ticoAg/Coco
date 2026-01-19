// Sidebar tree types for session management

export type SidebarMode = 'collapsed' | 'expanded';

export type TreeNodeType = 'repo' | 'task' | 'orchestrator' | 'worker' | 'file' | 'folder';

export interface TreeNodeData {
	id: string;
	type: TreeNodeType;
	label: string;
	interactionCount?: number | null;
	children?: TreeNodeData[];
	isExpanded?: boolean;
	isSelected?: boolean;
	isActive?: boolean;
	status?: string;
	actions?: Array<{ id: string; title: string }>;
	metadata?: {
		taskId?: string;
		agentInstance?: string;
		threadId?: string;
		path?: string;
		wtLabel?: string;
	};
}

export interface TaskDirectoryEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	sizeBytes: number | null;
	updatedAtMs: number | null;
}

export interface SidebarConfig {
	expandedWidth: number;
	collapsedWidth: number;
	defaultMode: SidebarMode;
}

export const DEFAULT_SIDEBAR_CONFIG: SidebarConfig = {
	expandedWidth: 260,
	collapsedWidth: 33.6,
	defaultMode: 'collapsed',
};
