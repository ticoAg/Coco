---
summary: "Delivery summary, verification, and impact notes"
doc_type: delivery
slug: "sidebar-wt-branch"
notes_dir: ".feat/20260119-1514-sidebar-wt-branch"
created_at_utc: "2026-01-19T15:14:07Z"
---
# Delivery Notes

交付时的详细说明（最终会随 squash merge 合回 base 分支）。

## Changes
- 后端：`codex_thread_list` 透传 thread `cwd` 到 `CodexThreadSummary`，供前端识别每个会话所在 worktree。(`apps/gui/src-tauri/src/lib.rs`)
- 前端：SessionTree 构建阶段把 `wt-[branch]` 作为 `TreeNodeData.metadata.wtLabel` 写入 `task/orchestrator/worker` 节点。(`apps/gui/src/features/codex-chat/CodexChat.tsx`)
- 前端：TreeNode 渲染 `wt-[branch]` suffix（固定宽度截断 + tooltip）。(`apps/gui/src/features/codex-chat/codex/sidebar/TreeNode.tsx`)

## Expected outcome
- 左侧 SessionTree 中，`task/orchestrator/worker` 节点标题末尾出现 `wt-[branch]`，可快速区分各会话对应的工作分支。
- branch 很长时 suffix 会被截断，hover 可查看完整 `wt-[branch]`。
- detached / 无法匹配时分别显示 `wt-[detached]` / `wt-[unknown]`。

## How to verify
- Commands:
  - `npm -C apps/gui run build`
  - `cargo check -p coco-app`
- Manual steps:
  - 打开 GUI → Codex Chat → 展开左侧 SessionTree，确认 `task/orchestrator/worker` 节点末尾展示 `wt-[branch]`。
  - 使用一个超长 branch name，确认 suffix 截断且 hover tooltip 展示全名。

## Impact / risks
- 变更仅为 UI 展示增强；不改变 sessions 数据源/归档分组/交互行为。
- 若 `cwd` 不存在或无法匹配到 worktree，fallback 为 `wt-[unknown]`（可能在极少数历史会话中出现）。

## References (path:line)
- `apps/gui/src-tauri/src/lib.rs:76`（`CodexThreadSummary` 增加 `cwd`）
- `apps/gui/src-tauri/src/lib.rs:1669`（`codex_thread_list` 透传 `cwd`）
- `apps/gui/src/features/codex-chat/CodexChat.tsx:1136`（SessionTree 构建处计算 `wt-[branch]`）
- `apps/gui/src/features/codex-chat/codex/sidebar/TreeNode.tsx:45`（渲染 `wt-[branch]` suffix）
