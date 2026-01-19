# Tasks: add-codex-app-server-adapter

## 1. Spec
- [x] 1.1 定义 adapter 的进程模型、JSON-RPC 握手与最小 RPC 集合（thread/list|start|resume|fork|rollback, turn/start|interrupt, model/list, config/read）。
- [x] 1.2 定义落盘：requests/notifications/stderr/session 文件路径与最小字段集合。
- [x] 1.3 定义 approvals → 事件/回调的最小语义（由 controller 映射为 gates）。

## 2. Implementation
- [x] 2.1 `coco-codex`: 提供可复用的 app-server client（spawn + stdio JSONL loop + request/notify/respond）。
- [x] 2.2 支持 per-agent `CODEX_HOME`（默认 `agents/<instance>/codex_home`），并允许显式覆盖。
- [x] 2.3 事件落盘：`runtime/requests.jsonl`、`runtime/events.jsonl`、`runtime/stderr.log`。
- [x] 2.4 session 落盘：`agents/<instance>/session.json`，随 threadId/fork 来源更新。
- [x] 2.5 orchestrator 集成：提供最小 API（start/resume/fork/start_turn/interrupt/respond_approval）。
- [x] 2.6 测试：用 mock 或最小集成测试覆盖“启动 + 发送请求 + 记录事件”。

## 3. Validation
- [x] 3.1 `openspec validate add-codex-app-server-adapter --strict`
- [x] 3.2 `cargo test -p coco-codex -p coco-orchestrator`
