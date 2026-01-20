---
summary: "Feature requirements and validation scope for tui-message-refresh"
doc_type: requirements
slug: "tui-message-refresh"
notes_dir: ".feat/20260120-1234-tui-message-refresh"
base_branch: "dev"
feature_branch: "feat/tui-message-refresh"
worktree: "../Coco-feat-tui-message-refresh"
created_at_utc: "2026-01-20T12:34:43Z"
---
# Feature Requirements: tui-message-refresh

> 使用与用户需求一致的语言填写本文档内容。

## Status
- Current: vFinal
- Base branch: dev
- Feature branch: feat/tui-message-refresh
- Worktree: ../Coco-feat-tui-message-refresh
- Created (UTC): 2026-01-20T12:34:43Z

## v0 (draft) - 2026-01-20T12:34:43Z

### Goals
- 当同一 thread 由外部客户端（如 codex tui）持续生成时，Coco GUI 的会话页面可自动刷新新增/增量消息。
- 本地 GUI 自身的 `codex_app_server` 流式事件与“外部更新刷新”相互独立：本地流式不被后台刷新打断或重置。
- 仅对 **selected thread** 做文件监听，且仅在“最近更新时间 < 2 分钟”窗口内触发后台刷新。

### Non-goals
- 不改动 codex tui 或 codex app-server 协议/实现。
- 不引入跨进程实时推送基础设施（WebSocket/PubSub 等）。

### Acceptance criteria
- 复现路径：codex tui 生成中，Coco GUI 打开同一会话后，消息可在合理延迟内自动更新（无需手动切换/刷新）。
- GUI 自己发起的 turn 仍能实时流式更新，不被后台刷新覆盖。
- 当 GUI 本地 activeTurnId 存在（流式中）时，不触发后台刷新；当本地空闲时，外部更新可触发刷新。
- 后台刷新仅针对 selected thread，且该会话未归档且更新时间在 2 分钟窗口内。
- 刷新后不丢失用户的折叠状态与基本界面状态（尽量保持）。

### Open questions
- 无（已确认）。

### Options / trade-offs
- Option C：Tauri 侧监听 selected thread 的 session 文件变更后推送到前端（已选择）。

### Verification plan
- 手动：
  1) 用 codex tui 启动会话并持续生成；
  2) `just dev` 启动 Coco，打开同一会话页面；
  3) 验证消息可自动刷新，且 GUI 本地流式生成不受影响。
- 自动化：暂无既有测试覆盖该实时刷新路径（若需要可补最小单测/集成测试）。

## vFinal - 2026-01-20

### Goals（确认版）
- 当同一 thread 由外部客户端（如 codex tui）持续生成时，Coco GUI 的会话页面可自动刷新新增/增量消息。
- 本地 GUI 的 `codex_app_server` 流式事件与“外部更新刷新”相互独立：本地流式不触发后台刷新。
- 仅对 selected thread 做文件监听；当文件变更触发时，若更新时间在 2 分钟内且该会话未归到 Archived，才应用后台刷新。
- 若文件变更发生在本地流式期间，则在本地流式结束后补一次刷新。

### Decisions
- 刷新策略：Tauri 监听 selected thread 的 session 文件变更并推送前端（Option C）。
- 最近更新时间判断点：**收到文件变更事件时**判断（1A）。
- Archived 判定：沿用 UI 现有规则（updatedAtMs 超过 1 小时分组为 Archived）（2A）。
- 本地流式期间收到外部更新：结束后补一次刷新（用户确认）。
