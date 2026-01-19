# Change: Add `wt-[branch]` label to Codex Session Tree

## Why
当前在左侧 SessionTree 中很难在“不进入会话”的情况下识别该会话正在使用的 worktree/branch；需要点进会话再从输入区的标识查看，成本高且容易选错工作目录。

## What Changes
- 在 Codex Chat 的 SessionTree（左侧树）中，为 `task` / `orchestrator` / `worker` 节点标题末尾新增 `wt-[branch]` suffix：
  - `wt` 为固定前缀
  - `[]` 内为 branch name
- 支持长 branch name 截断展示，并在 hover tooltip 显示完整 `wt-[branch]`。
- 为支持 per-session 展示：`codex_thread_list` 返回值透传 thread 的 `cwd`（来自 codex `thread/list` 响应），前端据此匹配 `git worktree list` 的结果拿到 branch。

## Impact
- Affected specs: `openspec/specs/gui-codex-chat/spec.md`
- Affected code:
  - `apps/gui/src-tauri/src/lib.rs`（`codex_thread_list` / `CodexThreadSummary`）
  - `apps/gui/src/types/codex.ts`（`CodexThreadSummary`）
  - `apps/gui/src/features/codex-chat/CodexChat.tsx`（sessionTree 构建：为节点附加 worktree/branch metadata）
  - `apps/gui/src/features/codex-chat/codex/sidebar/TreeNode.tsx`（渲染 suffix 标签）
