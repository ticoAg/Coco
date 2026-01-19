export type DiffLineKind = 'insert' | 'delete' | 'context' | 'ellipsis';

export type ParsedDiffLine = {
	kind: DiffLineKind;
	text: string;
	oldLine?: number;
	newLine?: number;
};

export type ParsedDiff = {
	lines: ParsedDiffLine[];
	added: number;
	removed: number;
	lineNumberWidth: number;
};

export type ParsedFileChangeKind = {
	type: 'add' | 'delete' | 'update';
	movePath?: string;
};

export type DiffReviewChange = {
	path: string;
	movePath?: string;
	kind: ParsedFileChangeKind;
	diff: string;
	parsed: ParsedDiff;
	lineNumbersAvailable?: boolean;
};

export type FileChangeSummary = {
	id: string;
	titlePrefix: string;
	titleContent: string;
	totalAdded: number;
	totalRemoved: number;
	changes: DiffReviewChange[];
};
