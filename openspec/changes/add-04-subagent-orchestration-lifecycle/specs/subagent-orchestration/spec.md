## ADDED Requirements

### Requirement: Spawn Multiple Subagents
系统 SHALL 支持在单个任务内启动多个 subagent（workers），并遵守 `task.yaml.config.maxConcurrentAgents` 的并发上限。

#### Scenario: Concurrency limit is enforced
- **GIVEN** `maxConcurrentAgents = 2`
- **WHEN** 尝试启动第 3 个 subagent
- **THEN** 系统拒绝启动并返回清晰错误

### Requirement: List Subagent Status
系统 SHALL 支持列出任务内所有 subagent 的当前状态，并能区分至少以下状态：`running`、`completed`、`failed`、`blocked`、`cancelled`。

#### Scenario: Status list reflects running worker
- **WHEN** 启动一个 worker 且其进程仍在运行
- **THEN** 列表中该 worker 的状态为 `running`

### Requirement: Wait for Any Completion
系统 SHALL 提供 `wait-any` 能力，阻塞直到任意一个 subagent 进入 terminal 状态（`completed/failed/cancelled/blocked`），并返回该 subagent 标识与状态。

#### Scenario: Return when first worker completes
- **GIVEN** 同时运行多个 worker
- **WHEN** 任意一个 worker 完成
- **THEN** `wait-any` 立即返回该 worker 的 `{agentInstance,status}`

### Requirement: Cancel Running Subagent
系统 SHALL 支持取消运行中的 subagent，并采用“先 SIGINT 后 SIGTERM”的渐进策略（或在当前平台等价实现）。

#### Scenario: Cancel leads to terminal state
- **GIVEN** 一个 worker 正在运行
- **WHEN** 用户请求 cancel
- **THEN** 该 worker 最终进入 `cancelled`（或 `failed`，需在事件中明确区分原因）

### Requirement: Persist Orchestration Events
系统 SHALL 将 subagent 生命周期关键事件写入任务级 `events.jsonl`（append-only），至少覆盖：启动、完成、失败、取消、阻塞。

#### Scenario: Agent started event is written
- **WHEN** subagent 启动成功
- **THEN** `events.jsonl` 中追加一条 `type` 以 `agent.` 开头的事件（例如 `agent.started`）

