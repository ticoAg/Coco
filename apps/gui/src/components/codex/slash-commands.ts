export type SlashCommandIcon =
	| 'cpu'
	| 'shield'
	| 'zap'
	| 'search'
	| 'plus'
	| 'play'
	| 'file-plus'
	| 'minimize'
	| 'git-branch'
	| 'at-sign'
	| 'info'
	| 'tool'
	| 'log-out'
	| 'x'
	| 'message'
	| 'trash'
	| 'paperclip';

export type SlashCommand = {
	id: string;
	label: string;
	description: string;
	icon: SlashCommandIcon;
};

// 命令顺序与 TUI2 保持一致（高频命令优先）
export const SLASH_COMMANDS: SlashCommand[] = [
	{ id: 'model', label: 'Model', description: '选择模型和推理强度', icon: 'cpu' },
	{ id: 'approvals', label: 'Approvals', description: '设置无需批准的操作', icon: 'shield' },
	{ id: 'skills', label: 'Skills', description: '使用技能改进任务执行', icon: 'zap' },
	{ id: 'review', label: 'Review', description: '审查当前更改并查找问题', icon: 'search' },
	{ id: 'new', label: 'New', description: '开始新会话', icon: 'plus' },
	{ id: 'resume', label: 'Resume', description: '恢复已保存的会话', icon: 'play' },
	{ id: 'init', label: 'Init', description: '创建 AGENTS.md 文件', icon: 'file-plus' },
	{ id: 'compact', label: 'Compact', description: '总结对话以防止达到上下文限制', icon: 'minimize' },
	{ id: 'diff', label: 'Diff', description: '显示 git diff（包括未跟踪文件）', icon: 'git-branch' },
	{ id: 'mention', label: 'Mention', description: '提及文件', icon: 'at-sign' },
	{ id: 'status', label: 'Status', description: '显示当前会话配置和 token 使用情况', icon: 'info' },
	{ id: 'mcp', label: 'MCP', description: '列出配置的 MCP 工具', icon: 'tool' },
	{ id: 'logout', label: 'Logout', description: '登出', icon: 'log-out' },
	{ id: 'quit', label: 'Quit', description: '退出', icon: 'x' },
	{ id: 'feedback', label: 'Feedback', description: '发送反馈', icon: 'message' },
	// GUI 特有命令
	{ id: 'clear', label: 'Clear', description: '清空当前对话', icon: 'trash' },
	{ id: 'context', label: 'Auto context', description: '切换 Auto context', icon: 'paperclip' },
];
