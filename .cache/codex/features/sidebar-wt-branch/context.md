# Context Notes

目标：记录最小但关键的上下文证据（入口、现状、约束、关键定位）。
要求：用 `path:line` 锚点，避免把大段日志贴进对话。

## Entrypoints
- `apps/gui/src/features/codex-chat/codex/sidebar/TreeNode.tsx:49` - SessionTree 每一行节点的渲染入口；当前仅渲染 `node.label`。
- `apps/gui/src/features/codex-chat/CodexChat.tsx:1136` - 构建 `sessionTree.treeData`（task/orchestrator/worker/file nodes），这里可把 worktree/branch 信息塞进 `TreeNodeData.metadata`。
- `apps/gui/src-tauri/src/lib.rs:1669` - `codex_thread_list` 里已经从 `thread/list` entry 解析了 `cwd`（用于过滤），但没有回传到前端；如果要在 sidebar 显示 per-session branch，需要把 cwd 暴露出来。
- `apps/gui/src-tauri/src/lib.rs:2631` - `git_worktree_list` 会返回 `WorktreeInfo { path, branch }`，可用于从 cwd 解析 branch。

## Current behavior
- SessionTree 节点标题只展示 `labelForThread(...)` 的结果；没有展示 thread 对应的 cwd/worktree/branch 信息。见 `apps/gui/src/features/codex-chat/codex/sidebar/TreeNode.tsx:94`。
- `CodexThreadSummary`（前端类型）不包含 `cwd` 字段；但后端 `codex_thread_list` 从 codex `thread/list` 响应中可读取到 `cwd`（仅用于过滤）。见 `apps/gui/src/types/codex.ts:9` 与 `apps/gui/src-tauri/src/lib.rs:1722`。

## Constraints / assumptions
- 目标只做“展示增强”，不改变 sessions 数据源与分组逻辑（Active/Archived 等）。
- 分支解析优先复用现有 `git_worktree_list` 的结果，避免对每个 session 单独跑 git 命令。
- branch 名称可能为空（detached），或无法从 worktree 列表匹配到；需要定义降级展示策略（见 requirements open questions）。

## Related tests / fixtures
- 当前未发现覆盖 SessionTree 细粒度渲染的单测；可能以 `npm -C apps/gui run build` + 手动验证为主。
