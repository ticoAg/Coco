/** 命令解析类型 */
export type ParsedCmdType = 'search' | 'read' | 'list_files' | 'format' | 'test' | 'lint' | 'noop' | 'unknown';

export interface ParsedCmd {
	type: ParsedCmdType;
	cmd: string;
	name?: string;
	query?: string;
	path?: string;
}

/** 审批策略类型 */
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
