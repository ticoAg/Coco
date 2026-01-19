---
summary: "Feature requirements and validation scope for ui-finished-working-overflow"
doc_type: requirements
slug: "ui-finished-working-overflow"
notes_dir: ".feat/20260119-1725-ui-finished-working-overflow"
base_branch: "dev"
feature_branch: "feat/ui-finished-working-overflow"
worktree: "../AgentMesh-feat-ui-finished-working-overflow"
created_at_utc: "2026-01-19T17:25:40Z"
---
# Feature Requirements: ui-finished-working-overflow

> 使用与用户需求一致的语言填写本文档内容。

## Status
- Current: vFinal
- Base branch: dev
- Feature branch: feat/ui-finished-working-overflow
- Worktree: ../AgentMesh-feat-ui-finished-working-overflow
- Created (UTC): 2026-01-19T17:25:40Z
- Confirmed (Local): 2026-01-19

## v0 (draft) - 2026-01-19T17:25:40Z

### Goals
- 定位“Finished working”展开后消息区域横向撑开/溢出 GUI 宽度的根因，并给出带 `path:line` 的证据。
- 明确触发条件（为何仅在展开后出现），输出可选修复方向供确认。

### Non-goals
- 不做界面样式重构或全局布局改造。
- 不改动与该问题无关的渲染/性能逻辑。

### Acceptance criteria
- 能指出至少一个直接导致横向撑开的具体节点/样式/数据路径，并给出 `path:line` 证据。
- 说明“展开后才触发”的原因链路（数据 -> 组件 -> 样式/布局）。
- 给出 1-2 个可行修复点与影响说明（待用户确认后再实现）。

### Open questions
- 这次是否只需要“定位原因”，还是希望我直接修复？
- 该问题是否仅出现在桌面 GUI（Tauri）？Web 端是否也复现？
- 你更倾向的期望行为：单行截断（ellipsis）还是允许多行换行但不撑宽？

### Options / trade-offs
- Option A: 在主聊天列的 flex item 上补 `min-w-0`（防止长文本撑开列宽）。
  - Trade-off: 文本可能被裁剪，需要配合更明确的截断样式。
- Option B: 在 `ActivityBlock`/`am-row-title` 上补 `min-w-0`/`max-w-full` 并保证 ellipsis 生效。
  - Trade-off: 文本仍为单行，但会截断，可能需要 hover/tooltip 才能看全。
- Option C: 允许摘要多行（去掉 `truncate`/`whitespace-nowrap`），以换行替代横向撑开。
  - Trade-off: 行高变大，列表密度下降。

### Verification plan
- Manual steps:
  - 打开一条包含长命令的对话，展开“Finished working”。
  - 观察聊天列与整体窗口宽度不应被撑开，且摘要文本表现符合预期（截断或换行）。

## vFinal - 2026-01-19

### Goals
- 修复“Finished working”展开后消息区域横向撑开的问题。
- 工作区块默认不换行，改为在各个 block 内横向滚动查看完整内容。

### Non-goals
- 不做全局布局重构，不改动非工作区块的展示逻辑。

### Acceptance criteria
- 展开“Finished working”后，聊天列宽度不被长命令/长路径撑开。
- 工作区块摘要行默认单行且可横向滚动查看完整文本。
- FileChange 头部/路径同样支持横向滚动，不再强制截断。

### Decision
- 选择方案 A：默认单行 + block 内横向滚动（不使用多行换行）。

### Verification plan
- Manual steps:
  - `just dev` 启动，展开包含长命令的“Finished working”。
  - 验证聊天列宽度稳定；在各工作 block 的标题区可横向滚动查看完整内容。
