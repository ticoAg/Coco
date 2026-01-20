---
summary: "Decision log for disagreements and trade-offs"
doc_type: disagreements
slug: "hide-turn-scrollbar"
notes_dir: ".feat/20260120-0058-hide-turn-scrollbar"
created_at_utc: "2026-01-20T00:58:58Z"
---
# Disagreement Log

当需求/方案存在分歧时，用这里显式记录，并给出选项与 trade-off。

- Topic: 作用范围
  - Option A: 仅 turn block（`am-block-command`）隐藏滚动条
  - Option B: 所有 `am-row-scroll` 统一隐藏
  - Decision: Option B（用户选择 1B）
  - Notes: 影响 `ActivityBlock`、`FileChangeEntryCard` 等所有使用 `am-row-scroll` 的区域。
- Topic: 浏览器范围
  - Option A: 仅 Chrome/Edge
  - Option B: Chrome/Edge + Firefox/Safari
  - Decision: Option A（用户选择 2A）
  - Notes: 采用 WebKit 滚动条伪元素实现，Safari 可能一并生效但不做验证。
