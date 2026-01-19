## 1. Implementation
- [x] 1.1 后端：在 `CodexThreadSummary` 增加可选字段 `cwd`，并在 `codex_thread_list` 中从 codex `thread/list` entry 透传（缺失时不序列化）。
- [x] 1.2 前端类型：`apps/gui/src/types/codex.ts` 的 `CodexThreadSummary` 增加 `cwd?: string | null`。
- [x] 1.3 前端：在 sessionTree 构建阶段增加 `threadId -> wt-[branch]` 的映射（branch 由 `git_worktree_list` 的结果匹配 `cwd` 得到；优先使用最长路径前缀匹配）。
- [x] 1.4 UI：`TreeNode` 渲染 `task/orchestrator/worker` 节点时显示 suffix 标签（固定宽度截断 + title tooltip）。
- [x] 1.5 验证：`npm -C apps/gui run build`；手动验证长 branch 截断/tooltip/交互不回归。

## 2. Spec
- [x] 2.1 `openspec validate add-sidebar-wt-branch-label --strict`
