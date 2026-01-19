# Change: add-codex-app-server-adapter

## Summary
新增 `codex-app-server-adapter` capability：以 `codex app-server`（JSON-RPC over stdio）作为底层可编程接口，在 Coco 中提供 **可恢复的 session/thread、细粒度事件流、内联审批（approvals）与 fork/rollback** 能力，并将原始记录稳定落盘到 Task Directory。

## Why
- `codex exec --json` 适合并行 worker 的 MVP，但交互粒度有限（尤其 approvals、长会话交互、细粒度 items 事件）。
- multi/subagent 方案需要更强的 session 语义：
  - 线程级隔离（thread）
  - turn 级流式事件（items）
  - 人工介入点（approval request → gate.blocked）
  - fork/rollback 用于“继承上下文 / 控制主线程污染”。

## What Changes
- 新增 capability：`codex-app-server-adapter`（在 `openspec/changes/.../specs/codex-app-server-adapter/spec.md` 定义）。
- 规定 adapter 作为“事件收集器 + 结构化提取器”的最小职责：
  - spawn `codex app-server` 子进程
  - JSON-RPC 初始化与请求/响应
  - 线程/回合生命周期（thread/*, turn/*）
  - 把 requests/notifications/stdio 原样落盘到 `agents/<instance>/runtime/*`
  - 生成/更新 `agents/<instance>/session.json`（threadId/cwd/codexHome 等）

## Non-Goals
- 不在本 change 中实现“模型 orchestrator 产出 actions → controller 状态机调度”的完整闭环（由后续 change 负责）。
- 不在本 change 中把 GUI 与 orchestrator 的 codex client 做强行合并重构；先以能力与落盘协议为准，代码复用在实现阶段逐步推进。

## Impact
- New spec: `codex-app-server-adapter`
- Affected code (implementation stage): [`crates/coco-codex`](../../../../crates/coco-codex)、[`crates/coco-orchestrator`](../../../../crates/coco-orchestrator)、（可选）[`apps/gui/src-tauri`](../../../../apps/gui/src-tauri) 提取公共 client。
- Docs: [`docs/coco/adapters/codex.md`](../../../../docs/coco/adapters/codex.md) 与 [`docs/implementation-notes/codex-cli/app-server-api.md`](../../../../docs/implementation-notes/codex-cli/app-server-api.md) 需要在实现阶段同步“实际支持的方法/字段/落盘”。
