# subagent-join-gates Specification

## Purpose
定义 subagent 的 join 汇总与 gates（input-required）机制：将多个 worker 的结构化最终输出收敛为共享报告，并在遇到阻塞/审批点时创建 `gate.blocked`、将任务置为 `input-required`，为 human-in-the-loop 提供统一锚点。
## Requirements
### Requirement: Join Worker Outputs
系统 SHALL 支持对同一任务内多个 worker 的最终输出进行 join，并产出共享汇总报告。

join 的输入 SHOULD 以 worker 的结构化最终输出为准：

- `agents/<id>/artifacts/final.json`（符合 `schemas/worker-output.schema.json`）

join 的输出 SHALL 至少包含：

- `shared/reports/joined-summary.md`（人类入口）

系统 MAY 同时写入：

- `shared/reports/joined-summary.json`（机器入口）

#### Scenario: Joined summary is written
- **GIVEN** 至少两个 worker 均已结束并写入 `agents/<id>/artifacts/final.json`
- **WHEN** Controller 执行 join
- **THEN** 写入 `shared/reports/joined-summary.md`

### Requirement: Joined Summary Template
系统 SHALL 提供一个最小 joined summary 模板，以便人类理解 join 报告结构与字段含义：

- `templates/JoinedSummary.md`

#### Scenario: Template exists in repo
- **WHEN** 开发者检出仓库
- **THEN** `templates/JoinedSummary.md` 存在

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

### Requirement: Gate Events
系统 SHALL 在写入 gate 事件时保证 payload 具备可追踪的最小字段集合，以便 GUI/脚本定位对应 gate。

事件 payload SHALL 包含：

- `gateId`

事件 payload SHOULD 包含：

- `reason`（可选）
- `agentInstance`（若该 gate 与某个 worker 对应）

系统 MAY 追加写入以下事件类型（MVP 允许仅定义事件形态）：

- `gate.approved`
- `gate.rejected`

#### Scenario: Gate blocked event includes gateId
- **WHEN** `events.jsonl` 追加写入 `gate.blocked`
- **THEN** 该事件 payload 包含 `gateId`

### Requirement: Human Notes Reference
blocked gate SHALL 引用 `shared/human-notes.md` 作为人工介入入口（例如 `instructionsRef` 指向该文件）。

#### Scenario: Gate points to human notes
- **WHEN** gate 被创建为 blocked
- **THEN** gate 的 `instructionsRef` 指向 `./shared/human-notes.md`
