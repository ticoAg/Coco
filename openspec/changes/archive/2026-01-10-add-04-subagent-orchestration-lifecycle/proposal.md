# Change: add-04-subagent-orchestration-lifecycle

## Summary
实现 subagents 的最小生命周期编排能力（spawn/list/wait-any/cancel），以 Task Directory 为事实来源落盘状态与事件，为 fork/join 与 GUI 状态展示打基础。

## Why
[`docs/agentmesh/roadmap.md`](../../../../docs/agentmesh/roadmap.md) Phase 1 明确要求一个最小 orchestrator：可并发、可暂停/可恢复、可把关键状态落盘，并在 “任意一个完成” 时能通知/返回。

## What Changes
- 为 subagent 引入明确的生命周期状态与事件写入（running/completed/failed/blocked/cancelled）。
- 提供 CLI/orchestrator 层的最小控制面：spawn N 个 worker、列出状态、阻塞等待任意完成、取消运行中 worker。
- 并发上限与超时策略对齐 `task.yaml` 的 `config`（例如 `maxConcurrentAgents`、`timeoutSeconds`）。

## Non-Goals
- 不在本 change 中实现 join 汇总与 gates（由 `add-05-subagent-join-gates` 覆盖）。
- 不在本 change 中切换到 `codex app-server`。

## Impact
- Specs（新增）：`subagent-orchestration`
- 受影响代码（实现阶段）：[`crates/agentmesh-orchestrator`](../../../../crates/agentmesh-orchestrator)、[`crates/agentmesh-core`](../../../../crates/agentmesh-core)（事件/状态落盘）
