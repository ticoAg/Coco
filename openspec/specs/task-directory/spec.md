# task-directory Specification

## Purpose
定义 AgentMesh 的 Task Directory（`.agentmesh/tasks/<task_id>/`）作为任务的唯一事实来源：承载任务状态、事件流、共享产物与人工介入入口，使任务可追踪、可复盘、可迁移，并支持 GUI 以 artifacts-first 的方式“只读”消费任务结果。
## Requirements
### Requirement: Task Directory Location
系统 SHALL 将每个任务落盘在工作区根目录下的 `.agentmesh/tasks/<task_id>/`。

#### Scenario: Create task directory under workspace
- **GIVEN** 工作区根目录存在（或可创建）
- **WHEN** 用户创建一个新任务
- **THEN** 系统在 `.agentmesh/tasks/<task_id>/` 创建对应任务目录

### Requirement: Task Directory Skeleton
系统 SHALL 创建以下最小目录骨架：
- `shared/`：跨 agent 的共享内容
- `agents/`：每个 agent instance 的运行记录与产物

#### Scenario: Skeleton is created on task creation
- **WHEN** 创建任务目录
- **THEN** `shared/` 与 `agents/` 目录均存在

### Requirement: Human Entry README
系统 SHALL 在任务目录下提供 `README.md` 作为人类入口，并至少包含任务 `id`、`topology`、`state` 信息。

#### Scenario: README exists with minimal fields
- **WHEN** 创建任务
- **THEN** `.agentmesh/tasks/<task_id>/README.md` 存在
- **AND** README 中可定位到 `id/topology/state` 三个字段

### Requirement: Task File (`task.yaml`)
系统 SHALL 在任务目录下写入 `task.yaml`，并满足：
- 文件可被解析为 `TaskFile`（字段命名为 `camelCase`）
- 至少包含：`id`、`title`、`topology`、`state`

#### Scenario: Task file is readable after creation
- **WHEN** 创建任务后读取 `.agentmesh/tasks/<task_id>/task.yaml`
- **THEN** 能解析得到 `TaskFile`
- **AND** `id/title/topology/state` 非空

### Requirement: Task Events Log (`events.jsonl`)
系统 SHALL 在任务目录下维护 `events.jsonl` 作为 append-only 的事件流，并满足：
- 每条事件为一行 JSON（JSON Lines）
- 事件包含 `ts`（ISO 8601）、`type`、`taskId`
- 写入时追加 `\\n`，避免多条事件写在同一行

#### Scenario: Task created event is appended
- **WHEN** 创建任务成功
- **THEN** `.agentmesh/tasks/<task_id>/events.jsonl` 至少包含一条 `type = "task.created"` 的事件

### Requirement: Human-in-the-loop Files (MVP)
系统 SHALL 在 `shared/` 下提供用于“人工介入”的落盘入口文件，并至少包含：
- `shared/human-notes.md`：人工纠错/补充输入入口
系统 SHOULD 同时提供：
- `shared/context-manifest.yaml`：显式共享清单入口

#### Scenario: Human notes exists for every task
- **WHEN** 创建任务目录
- **THEN** `shared/human-notes.md` 存在

#### Scenario: Context manifest exists by default
- **WHEN** 创建任务目录
- **THEN** `shared/context-manifest.yaml` 存在

### Requirement: Backward-Compatible Task States
系统 SHALL 在解析 `task.yaml` 时兼容历史值：
- `state: gate.blocked` 视为 `input-required`
- `state: cancelled` 视为 `canceled`

#### Scenario: Parse legacy state values
- **GIVEN** `task.yaml` 中 `state` 为 `gate.blocked`
- **WHEN** 解析为 `TaskFile`
- **THEN** 系统将其映射为 `input-required`
