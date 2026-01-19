# Design: add-05-subagent-join-gates

## Join Strategy (MVP)
- Join 的输入是每个 worker 的 `artifacts/final.json`（符合 [`schemas/worker-output.schema.json`](../../../../schemas/worker-output.schema.json)）。
- Join 的输出是 `shared/reports/joined-summary.md`（人类入口），可选 `joined-summary.json`（机器入口）。
- Join 不负责合并代码变更（worktree/branch 的合并由人类或后续工具完成）。

## Gates Strategy (MVP)
- `blocked` 的真源来自 worker 输出（`status=blocked` + `questions`）。
- Orchestrator 将其映射为 task-level：
  - `task.state = input-required`
  - `gates[].state = blocked`
  - `events.jsonl` 追加 `gate.blocked`
- 人类通过编辑 `shared/human-notes.md` 提供补充，再触发 resume（下一 change 可完善）。

## Open Questions
- `Gate` 的 `id` 生成策略：基于 `{task_id, agent_instance, reason}` 派生，还是随机 id？
- 多个 blocked worker：是否合并成一个 gate 还是每个 worker 一个 gate（建议：每个 worker 一个 gate，join 摘要里汇总）。
