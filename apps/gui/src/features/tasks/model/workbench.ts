import type { SharedArtifactCategory } from '@/types/task';

export type WorkbenchNode =
	| { kind: 'sharedFile'; path: string; label: string }
	| { kind: 'sharedArtifact'; category: SharedArtifactCategory; path: string; label: string }
	| { kind: 'agent'; agentInstance: string; section: 'session' | 'final' | 'events' | 'stderr' };

export const ARTIFACT_CATEGORIES: SharedArtifactCategory[] = ['reports', 'contracts', 'decisions'];

export const DEFAULT_SHARED_FILES: Array<Extract<WorkbenchNode, { kind: 'sharedFile' }>> = [
	{ kind: 'sharedFile', path: 'shared/state-board.md', label: 'state-board.md' },
	{ kind: 'sharedFile', path: 'shared/human-notes.md', label: 'human-notes.md' },
	{ kind: 'sharedFile', path: 'shared/context-manifest.yaml', label: 'context-manifest.yaml' },
];

export function workbenchNodeKey(node: WorkbenchNode): string {
	switch (node.kind) {
		case 'sharedFile':
			return 'sharedFile:' + node.path;
		case 'sharedArtifact':
			return 'sharedArtifact:' + node.category + ':' + node.path;
		case 'agent':
			return 'agent:' + node.agentInstance + ':' + node.section;
	}
}
