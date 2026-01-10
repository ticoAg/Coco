## ADDED Requirements

### Requirement: Sessions View
GUI SHALL 在任务详情中展示该任务的 subagents/sessions 概览，并至少包含：agent instance id（目录名）、状态（按推导规则）、最后更新时间（按推导规则）。

#### Scenario: List sessions from task directory
- **GIVEN** `.agentmesh/tasks/<task_id>/agents/` 下存在一个或多个 agent instance 目录
- **WHEN** 用户打开任务详情页
- **THEN** GUI 展示 sessions 列表

### Requirement: Minimal Data Source (Task Directory Only)
GUI SHALL 仅通过读取任务目录来构建 sessions 视图，不依赖常驻服务，并将 `agents/<instance>/` 目录视为一个 session。
GUI MAY 读取以下文件（如存在）：
- `agents/<instance>/session.json`
- `agents/<instance>/artifacts/final.json`
- `agents/<instance>/runtime/events.jsonl`

当任意文件缺失或不可解析时，GUI SHALL 仍可展示该 session（以 unknown/空值呈现缺失字段）。

#### Scenario: Render sessions with missing artifacts
- **GIVEN** 某个 `agents/<instance>/` 仅存在 `runtime/events.jsonl` 或仅存在 `artifacts/final.json`
- **WHEN** 用户打开任务详情页
- **THEN** GUI 仍列出该 session，并对缺失字段显示 unknown/空值

### Requirement: Derive Session Status
GUI SHALL 以 artifacts-first 的方式推导 session 状态：
1. 若 `artifacts/final.json` 存在且包含 `status` 字段，则：
   - `success` → `completed`
   - `blocked` → `blocked`
   - `failed` → `failed`
   - 其他值 → `unknown`
2. 否则若 `runtime/events.jsonl` 存在且非空 → `running`
3. 否则 → `unknown`

#### Scenario: Status from final.json
- **GIVEN** `artifacts/final.json` 存在且 `status` 为 `success`
- **WHEN** GUI 渲染 sessions 列表
- **THEN** 该 session 状态为 `completed`

#### Scenario: Status fallback to events.jsonl
- **GIVEN** `artifacts/final.json` 不存在 且 `runtime/events.jsonl` 存在且非空
- **WHEN** GUI 渲染 sessions 列表
- **THEN** 该 session 状态为 `running`

### Requirement: Derive Last Updated Time
GUI SHALL 推导 `lastUpdatedAt` 用于 sessions 列表展示，优先级如下：
1. `runtime/events.jsonl` 的 mtime（如存在）
2. `artifacts/final.json` 的 mtime（如存在）
3. `session.json` 的 mtime（如存在）
4. 否则 `lastUpdatedAt` 为 unknown（GUI MAY 显示空值）

#### Scenario: lastUpdatedAt prefers events.jsonl
- **GIVEN** 同一 session 下同时存在 `runtime/events.jsonl` 与 `artifacts/final.json`
- **WHEN** GUI 渲染 sessions 列表
- **THEN** lastUpdatedAt 使用 `runtime/events.jsonl` 的 mtime

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
