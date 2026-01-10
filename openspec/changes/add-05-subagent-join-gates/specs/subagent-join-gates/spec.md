## ADDED Requirements

### Requirement: Join Worker Outputs
系统 SHALL 支持对同一任务内多个 worker 的最终输出进行 join，并产出共享汇总报告。

#### Scenario: Joined summary is written
- **GIVEN** 至少两个 worker 均已结束并写入 `agents/<id>/artifacts/final.json`
- **WHEN** orchestrator 执行 join
- **THEN** 写入 `shared/reports/joined-summary.md`

### Requirement: Joined Summary Content
join 汇总报告 SHALL 包含每个 worker 的：
- `status`
- `summary`
- `questions`（若存在）
- `nextActions`（若存在）

#### Scenario: Blocked questions are visible in joined report
- **GIVEN** 某 worker `status=blocked` 且包含 `questions`
- **WHEN** 生成 joined summary
- **THEN** 报告中包含该 `questions` 列表

### Requirement: Gate Creation on Blocked
当任一 worker 输出 `status=blocked` 时，系统 SHALL：
- 设置 task-level `state = input-required`
- 在 `task.yaml.gates[]` 创建或更新一条 `state = blocked` 的 gate
- 写入一条 `gate.blocked` 事件到 `events.jsonl`

#### Scenario: Task becomes input-required when blocked
- **WHEN** 某 worker 以 `blocked` 结束
- **THEN** 任务状态变为 `input-required`
- **AND** 至少存在一个 gate 处于 `blocked`

### Requirement: Human Notes Reference
blocked gate SHALL 引用 `shared/human-notes.md` 作为人工介入入口（例如 `instructionsRef` 指向该文件）。

#### Scenario: Gate points to human notes
- **WHEN** gate 被创建为 blocked
- **THEN** gate 的 `instructionsRef` 指向 `./shared/human-notes.md`
