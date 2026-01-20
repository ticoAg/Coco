---
summary: "Feature requirements and validation scope for hide-turn-scrollbar"
doc_type: requirements
slug: "hide-turn-scrollbar"
notes_dir: ".feat/20260120-0058-hide-turn-scrollbar"
base_branch: "dev"
feature_branch: "feat/hide-turn-scrollbar"
worktree: "../AgentMesh-feat-hide-turn-scrollbar"
created_at_utc: "2026-01-20T00:58:58Z"
---
# Feature Requirements: hide-turn-scrollbar

## Status
- Current: vFinal (confirmed 2026-01-20)
- Base branch: dev
- Feature branch: feat/hide-turn-scrollbar
- Worktree: ../AgentMesh-feat-hide-turn-scrollbar
- Created (UTC): 2026-01-20T00:58:58Z

## v0 (draft) - 2026-01-20

### Goals
- 隐藏所有 `am-row-scroll` 横向滚动条（仅保证 Chrome/Edge），且不占用布局空间。
- 保持 `am-row-scroll` 的横向滚动能力（触控板/鼠标/拖拽）。

### Non-goals
- 不调整 `am-row-scroll` 之外的滚动区域（如 `.am-shell-scroll`）。
- 不覆盖 Firefox 等非 Chromium 浏览器的滚动条隐藏需求（维持现状）。
- 不改变现有组件结构或交互行为。

### Acceptance criteria
- Chrome/Edge 中 `am-row-scroll` 的水平滚动条不可见且不占空间。
- `am-row-scroll` 仍可横向滚动，且交互无回归。
- `.am-shell-scroll` 等其他滚动样式不受影响。

### Open questions
- 无。

### Options / trade-offs
- 作用范围：
  - Option A: 仅 turn block（`am-block-command`）隐藏
  - Option B: 所有 `am-row-scroll` 统一隐藏（已选）
- 浏览器范围：
  - Option A: 仅 Chrome/Edge（已选）
  - Option B: Chrome/Edge + Firefox/Safari

### Verification plan
- Unit tests: N/A
- Integration tests: N/A
- Manual steps:
  - 在 Chrome/Edge 打开含 turn block 的页面，确认横向滚动条不可见且仍可左右滑动。

## vFinal - 2026-01-20

与 v0 一致（用户已确认 1B/2A）：
- 隐藏所有 `am-row-scroll` 横向滚动条（仅保证 Chrome/Edge），不占用布局空间。
- 保持 `am-row-scroll` 的横向滚动能力；不影响 `.am-shell-scroll` 等其他滚动区域。
