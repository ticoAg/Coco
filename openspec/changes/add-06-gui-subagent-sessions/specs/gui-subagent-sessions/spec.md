## ADDED Requirements

### Requirement: Sessions View
GUI SHALL 在任务详情中展示该任务的 subagents/sessions 概览，并至少包含：agent instance id、状态、最后更新时间。

#### Scenario: List sessions from task directory
- **GIVEN** `.agentmesh/tasks/<task_id>/agents/` 下存在一个或多个 agent instance 目录
- **WHEN** 用户打开任务详情页
- **THEN** GUI 展示 sessions 列表

### Requirement: Read-Only by Default
GUI SHALL 以只读方式消费任务目录，不要求通过 GUI 执行 spawn/cancel/approve 等写操作（MVP）。

#### Scenario: No write operations required
- **WHEN** 用户浏览 sessions 与 reports
- **THEN** 所有展示均来自读取任务目录文件

### Requirement: Show Worker Final Output
GUI SHALL 展示每个 worker 的结构化最终输出（来自 `agents/<instance>/artifacts/final.json`），至少展示 `status` 与 `summary`。

#### Scenario: Show final.json summary
- **GIVEN** `artifacts/final.json` 存在且可解析
- **WHEN** 用户查看该 session
- **THEN** GUI 显示 `status` 与 `summary`

### Requirement: Show Runtime Events
GUI SHALL 支持查看每个 session 的 runtime 事件（来自 `agents/<instance>/runtime/events.jsonl`），MVP 可展示最近 N 条并支持刷新。

#### Scenario: Show last N runtime events
- **GIVEN** `runtime/events.jsonl` 存在
- **WHEN** 用户打开 session 详情
- **THEN** GUI 展示最近 N 条事件
