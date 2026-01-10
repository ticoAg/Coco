# Change: add-03-codex-exec-adapter

## Summary
实现基于 `codex exec --json` 的最小 Codex adapter：以“子进程 + JSONL 事件流”驱动 subagent worker，并将原始记录与结构化最终输出落盘到 Task Directory。

## Why
`docs/agentmesh/subagents.md` 与 `docs/agentmesh/adapters/codex.md` 明确指出：在 Phase 1/2，`codex exec --json` 是最省事的路径（无需常驻服务），并且 GUI/Orchestrator 可以稳定消费 JSONL 事件驱动状态。

## What Changes
- 在 `agentmesh-codex` 中实现 worker runner：spawn `codex exec --json`，解析/转存 JSONL，记录 `thread_id`，落盘 `session.json` 与 `artifacts/final.json`。
- 为每个 worker 设置独立 `CODEX_HOME`（推荐落盘到 `agents/<id>/codex_home/`），保证上下文/会话隔离。
- 支持通过 `--output-schema` 强制最终输出符合 `schemas/worker-output.schema.json`。

## Non-Goals
- 不实现 `codex app-server`（Phase 2+ 再做）。
- 不在本 change 中完成 subagent 的 fork/join 编排（由后续 subagent changes 实现）。

## Impact
- Specs（新增）：`codex-exec-adapter`
- 受影响代码（实现阶段）：`crates/agentmesh-codex`、`.agentmesh/tasks/*/agents/*` 落盘结构
- 文档影响：可能需要在 `docs/agentmesh/adapters/codex.md` 中补充“实际落盘路径/字段”一致性（实现阶段再同步）
