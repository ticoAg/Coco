# Tasks: add-04-subagent-orchestration-lifecycle

## 1. Spec
- [ ] 定义 subagent 的生命周期状态、最小事件类型，以及它们在 `task.yaml`/`events.jsonl` 中的落盘方式。
- [ ] 定义并发限制与超时策略（对齐 `TaskConfig`）。

## 2. Implementation (apply 阶段执行)
- [ ] 在 orchestrator/CLI 实现：`subagent spawn|list|wait-any|cancel`（内部调用 codex adapter）。
- [ ] 将 subagent 状态写入 task-level `events.jsonl`（`agent.started/completed/failed/cancelled` 等）。
- [ ] `wait-any` 支持超时参数，并返回 `{agentInstance,status}` 的机器可读输出（`--json`）。

## 3. Validation
- [ ] `openspec validate add-04-subagent-orchestration-lifecycle --strict`
- [ ] 为 orchestrator 添加最小单测（至少覆盖：并发上限拒绝、取消状态落盘）。
