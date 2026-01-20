---
summary: "Decision log for disagreements and trade-offs"
doc_type: disagreements
slug: "tui-message-refresh"
notes_dir: ".feat/20260120-1234-tui-message-refresh"
created_at_utc: "2026-01-20T12:34:43Z"
---
# Disagreement Log

> 使用与用户需求一致的语言填写本文档内容。

当需求/方案存在分歧时，用这里显式记录，并给出选项与 trade-off（然后停下等用户选择）。

- Topic: 跨客户端会话刷新策略（TUI -> GUI 实时更新）
  - Option A: 复用 session 列表轮询（已有 7s 定时器），当 selected thread 的 `updatedAtMs/interactionCount` 变化时触发 `thread/resume` 刷新。
    - 优点：改动小、无需新增后台监听/协议；能利用现有 updatedAtMs 识别外部更新。
    - 缺点：刷新粒度受 7s 轮询影响，实时性一般。
  - Option B: 为 selected thread 增加独立短间隔轮询（如 2-3s）调用 `thread/resume`，直到不再 inProgress。
    - 优点：实时性更好。
    - 缺点：请求更频繁，可能带来 UI 抖动或额外开销。
  - Option C: Tauri 侧监听 session 文件变更并推送前端刷新。
    - 优点：延迟低、无需频繁轮询。
    - 缺点：跨平台文件监听成本高、实现复杂。
  - Decision: Option C（仅 selected thread 文件监听推送）
  - Notes: 由用户确认 2026-01-20

- Topic: 本地流式与后台刷新是否独立
  - Option A: 本地 activeTurnId 存在时暂停后台刷新（你提出“彼此独立”，等同该选项）。
  - Option B: 保持后台刷新但需合并/去重（更复杂）。
  - Decision: Option A
  - Notes: 由用户确认 2026-01-20；补充：本地流式结束后补一次刷新

- Topic: “最近更新时间 < 2 分钟”的判断点
  - Option A: 仅在收到文件变更事件时判断，满足才触发刷新。
  - Option B: 选中会话时判断是否开启监听；超过 2 分钟则不启动监听。
  - Decision: Option A
  - Notes: 由用户确认 2026-01-20

- Topic: “外部客户端”判定逻辑
  - Option A: 仅以“本地 activeTurnId 是否为空”作为区分（简单、符合你说的“本地流式不触发刷新”）。
  - Option B: 依赖 thread.source / cliVersion 等字段（目前前端未使用，可能不稳定）。
  - Decision: Option A
  - Notes: 由用户确认 2026-01-20

- Topic: Archived 判定规则
  - Option A: 沿用 UI 现有规则（updatedAtMs > 1 小时分组为 Archived）。
  - Option B: 使用 archive guard/archived_sessions 目录作为真实归档依据。
  - Decision: Option A
  - Notes: 由用户确认 2026-01-20
