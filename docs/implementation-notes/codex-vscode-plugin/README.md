# Codex VSCode 插件原理笔记

本目录记录 Codex VSCode 插件（本地安装包中的 webview 资源）相关的实现原理。

## 目录索引

- `auto-context.md`：Auto context（IDE 上下文）开关与 IPC 交互逻辑
- `conversation-folding-ui.md`：AI 会话多层级折叠/显示 UI 机制
- `conversation-data-flow.md`：会话数据流与聚合逻辑（插件与 Coco GUI 对照）
- `workspace-tree-ui.md`：Workspace 树与侧边栏任务分组 UI
- `tooling-cards-ui.md`：工具与内容卡片 UI（Exec / Reading / Reasoning / MCP）
- `diff-review-ui.md`：Diff 评审与折叠机制
- `worktree-init-ui.md`：Worktree 初始化与进度提示 UI
- `inbox-remote-ui.md`：Inbox 与 Remote 线程 UI
