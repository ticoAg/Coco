# orchestrator-controller-loop Specification

## Purpose
TBD - created by archiving change add-orchestrator-controller-loop. Update Purpose after archive.
## Requirements
### Requirement: Orchestrator Actions Output
系统 SHALL 支持由 Orchestrator（模型）输出结构化的 `actions`，并由 Controller 解析执行。

`actions` 输出 SHALL 为 JSON 对象，至少包含：
- `sessionGoal`: string
- `tasks`: array（每个 task 至少包含 `taskId/title/agent/adapter/prompt`）

系统 SHALL 提供 [`schemas/orchestrator-actions.schema.json`](../../../schemas/orchestrator-actions.schema.json) 作为最小 JSON Schema，并要求 Orchestrator 输出与该 schema 兼容。

#### Scenario: Parse actions from orchestrator
- **GIVEN** Orchestrator 输出一个包含 `sessionGoal` 与 `tasks[]` 的 JSON
- **WHEN** Controller 接收该输出
- **THEN** Controller 能解析并得到至少一个待执行的 task

#### Scenario: Actions output validates against schema
- **GIVEN** 一个 actions JSON 文件
- **WHEN** 使用 [`schemas/orchestrator-actions.schema.json`](../../../schemas/orchestrator-actions.schema.json) 校验该 JSON
- **THEN** 校验通过

### Requirement: Controller State Machine
系统 SHALL 以程序状态机的方式执行 `actions`，并在 Task Directory 中落盘关键状态与中间产物。

最小状态 SHALL 覆盖：
- `dispatching`（创建 agent instances / 启动执行）
- `monitoring`（等待事件与结果）
- `joining`（收敛结果生成共享报告）
- `blocked`（等待人类输入或审批）
- `done`（完成/失败）

#### Scenario: Controller writes progress events
- **WHEN** Controller 从 dispatching 进入 monitoring
- **THEN** `events.jsonl` 追加一条反映状态变化的事件（例如 `controller.state.changed`）

### Requirement: StateBoard Artifact
系统 SHALL 在任务目录维护一个高信噪比的状态看板文件：`shared/state-board.md`，用于：

- 汇总当前 session goal / 关键约束
- 汇总 subtasks 的状态（running/completed/blocked/failed）
- 指向关键产物与介入点（joined summary / evidence index / human-notes）

#### Scenario: StateBoard exists after dispatch
- **WHEN** Controller dispatch subtasks
- **THEN** `shared/state-board.md` 存在且包含 `sessionGoal`

### Requirement: Task Workspace Per Subtask
系统 SHALL 为每个 subtask 维护独立的 task workspace（目录 + 运行记录 + 产物），并将其挂载为 task roster 中的一个 `agent instance`。

#### Scenario: Subtask workspace is created
- **WHEN** Controller dispatch 一个 task
- **THEN** `.agentmesh/tasks/<task_id>/agents/<agent_instance>/` 目录存在
- **AND** `task.yaml.roster[]` 包含该 `agent instance`

### Requirement: Fork vs Spawn Dispatch Policy
系统 SHALL 支持两种派生策略：

- `spawn`：启动新的 vendor session（最小上下文）
- `fork`：从一个 parent session 派生（继承上下文）

当 task 指定 `mode=fork` 时，Controller SHALL 记录 fork 关系（例如写入 `agents/<instance>/session.json` 的 `vendorSession.forkedFromThreadId` 字段）。

#### Scenario: Fork mode records parent
- **GIVEN** 一个 task 指定 `mode=fork`
- **WHEN** Controller 派生并启动子会话
- **THEN** 子会话的 `session.json` 记录其 parent session 标识

### Requirement: Evidence-First Result Contract
系统 SHALL 要求每个 subtask 的最终交付为结构化文件，并可被 join 汇总消费。

最小交付 SHOULD 对齐 [`schemas/worker-output.schema.json`](../../../schemas/worker-output.schema.json)（例如 `agents/<instance>/artifacts/final.json`）。

#### Scenario: Join reads final outputs
- **GIVEN** 至少两个 subtask 均已写入 `artifacts/final.json`
- **WHEN** Controller 执行 join
- **THEN** `shared/reports/joined-summary.md` 生成且包含每个 subtask 的 `status` 与 `summary`

### Requirement: Human-in-the-Loop Resume
当任一 subtask 进入 `blocked`（需要人类输入/审批）状态时，系统 SHALL：

- 将 task state 置为 `input-required`
- 创建或更新一个 blocked gate（参见 `subagent-join-gates` capability）
- 等待用户在 `shared/human-notes.md`（或 GUI）补充后，再允许 Controller resume 执行

#### Scenario: Blocked requires human notes
- **WHEN** 某 subtask 输出 `status=blocked`
- **THEN** task state 变为 `input-required`
- **AND** gate 指向 `./shared/human-notes.md`

