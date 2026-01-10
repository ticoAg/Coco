# Tasks: add-gui-codex-chat-core

## 1. Implementation
- [x] 1.1 确认采用 `codex app-server` 作为 GUI 交互协议（满足审批与会话列表能力）。
- [x] 1.2 在 `apps/gui/src-tauri` 增加 codex 进程管理与 JSON-RPC 处理（initialize、thread/list、thread/start/resume、turn/start/interrupt、审批响应）。
- [x] 1.3 增加 `~/.codex/config.toml` 读取/写入 IPC（跨平台 HOME 解析）。
- [x] 1.4 新增 Codex Chat 视图 UI（会话列表、消息流、输入框）。
- [x] 1.5 输入区增加 `model` 与 `model_reasoning_effort` 下拉，并传递到 turn/start 覆盖参数。
- [x] 1.6 在消息流中渲染 command/file/tool/web_search 事件，并维护状态更新。
- [x] 1.7 审批请求以内联消息提供“批准/拒绝”，并回传至 codex。

## 2. Validation
- [x] openspec validate add-gui-codex-chat-core --strict
- [x] npm -C apps/gui run build
