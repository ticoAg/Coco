# codex-app-server-adapter Specification

## Purpose
TBD - created by archiving change add-codex-app-server-adapter. Update Purpose after archive.
## Requirements
### Requirement: External `codex` Dependency
系统 SHALL 将 `codex` 视为外部可执行依赖（通过 PATH 或显式配置发现），并在缺失时返回可理解的错误信息。

#### Scenario: Codex not installed
- **GIVEN** PATH 中不存在 `codex` 且未配置 `codexBin`
- **WHEN** 系统尝试启动 codex app-server adapter
- **THEN** adapter 启动失败并返回“codex not found”错误

### Requirement: Spawn and Initialize `codex app-server`
系统 SHALL 通过子进程启动 `codex app-server`，并完成 JSON-RPC 初始化握手：

- `initialize`（带 `clientInfo`）
- `initialized`

#### Scenario: App-server initializes successfully
- **WHEN** adapter 启动 `codex app-server`
- **THEN** 系统发送 `initialize` 并收到成功响应
- **AND** 随后发送 `initialized`

### Requirement: Per-Agent `CODEX_HOME`
系统 SHALL 为每个 agent instance 提供独立 `CODEX_HOME`（默认：`agents/<instance>/codex_home/`），用于隔离 codex sessions/rollouts/cache。

#### Scenario: Two adapters use different CODEX_HOME
- **WHEN** 同一 task 并发启动两个 agent instance 的 app-server adapter
- **THEN** 两个进程使用不同的 `CODEX_HOME` 目录

### Requirement: Thread Lifecycle Support (list/start/resume/fork/rollback)
adapter SHALL 支持通过 JSON-RPC 调用 Codex 的 thread 生命周期方法，至少包括：

- `thread/list`
- `thread/start`
- `thread/resume`
- `thread/fork`
- `thread/rollback`

#### Scenario: Fork thread creates a new thread id
- **GIVEN** 已存在一个 thread
- **WHEN** adapter 调用 `thread/fork` 从该 thread 派生
- **THEN** 返回一个新的 thread id

### Requirement: Turn Lifecycle Support (start/interrupt + streaming events)
adapter SHALL 支持：

- `turn/start` 发起回合
- `turn/interrupt` 中断回合
- 订阅/接收 streaming notifications，并可将其作为事件流输出

#### Scenario: Turn events are streamed while running
- **GIVEN** 一个 thread 已启动
- **WHEN** adapter 调用 `turn/start`
- **THEN** adapter 在回合进行中持续收到并向上层输出事件

### Requirement: Model and Config Read Support
adapter SHALL 支持通过 JSON-RPC 调用 Codex 的以下方法，用于“可发现性/可配置性”：

- `model/list`
- `config/read`

#### Scenario: Model list can be queried
- **WHEN** 上层通过 adapter 调用 `model/list`
- **THEN** adapter 返回可用模型列表（按 app-server 的实际返回字段为准）

#### Scenario: Effective config can be queried
- **WHEN** 上层通过 adapter 调用 `config/read`
- **THEN** adapter 返回当前生效配置（按 app-server 的实际返回字段为准）

### Requirement: Task Directory Recording
系统 SHALL 将 app-server 的交互与事件原样落盘到 Task Directory（per agent instance）：

- `agents/<instance>/runtime/requests.jsonl`：client→server 的 JSON-RPC 消息（requests / notifications / responses；append-only）
- `agents/<instance>/runtime/events.jsonl`：server→client 的 JSON-RPC 消息（responses / notifications / requests；append-only）
- `agents/<instance>/runtime/stderr.log`：stderr 原样追加
- `agents/<instance>/session.json`：用于恢复/复盘的最小会话信息（至少包含 threadId、cwd、codexHome、recording paths）

#### Scenario: Requests and notifications are recorded
- **WHEN** adapter 运行并与 app-server 交互
- **THEN** `runtime/requests.jsonl` 与 `runtime/events.jsonl` 都被持续追加写入

#### Scenario: Session file stores the latest thread id
- **GIVEN** adapter 已创建或恢复一个 thread
- **WHEN** adapter 更新 `agents/<instance>/session.json`
- **THEN** 文件中包含当前 `threadId`

### Requirement: Approval Requests Are Surfaced
当 app-server 发出需要 client 响应的请求（例如 approvals）时，adapter SHALL 将该请求作为一等事件暴露给上层，并提供 `respond(requestId, result)` 将用户决策回传给 app-server。

#### Scenario: Approval request can be responded
- **GIVEN** 一个回合触发了 approval request
- **WHEN** 上层通过 adapter 调用 `respond` 发送批准/拒绝
- **THEN** 回合继续执行或按拒绝语义终止

### Requirement: App-Server Pool by CODEX_HOME
系统 SHALL 支持以 “pool” 的方式管理多个 `codex app-server` 实例，并允许上层按 `codexHome`（映射到 `CODEX_HOME`）选择要使用的实例。

pool 的最小要求：
- 支持同时存在多个 app-server 实例（至少 2 个）
- 每个实例绑定一个 `codexHome`（不同实例可使用不同 `codexHome`）

#### Scenario: Spawn two servers with different CODEX_HOME
- **GIVEN** 上层请求启动两个 app-server，分别指定不同 `codexHome`
- **WHEN** pool 启动这两个实例
- **THEN** 两个实例都可被独立调用且互不影响

### Requirement: App-Server Handle (appServerId) for Routing
当系统启用 pool 模式时，adapter SHALL 为每个 app-server 实例暴露一个稳定句柄 `appServerId`，并要求上层在调用 thread/turn/config 等方法时携带 `appServerId`（或等价作用域信息），以确保请求被路由到正确实例。

#### Scenario: RPC call is scoped to appServerId
- **GIVEN** pool 中存在两个 appServerId
- **WHEN** 上层对其中一个 appServerId 调用 `thread/list`
- **THEN** 仅返回该 appServerId 对应实例可见的 threads

### Requirement: Events Carry App-Server Source
系统 SHALL 在向上层转发 app-server 的 streaming events（notifications/requests）时携带来源信息（至少包含 `appServerId`），以支持 GUI 的多 panel / 多会话并行显示与事件路由。

#### Scenario: Notification includes appServerId
- **GIVEN** 两个 appServerId 同时产生 notifications
- **WHEN** adapter 向上层转发这些 notifications
- **THEN** 每条 event 都包含其来源的 `appServerId`

