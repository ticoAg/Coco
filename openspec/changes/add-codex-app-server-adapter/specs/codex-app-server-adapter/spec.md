## ADDED Requirements

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

### Requirement: Task Directory Recording
系统 SHALL 将 app-server 的交互与事件原样落盘到 Task Directory（per agent instance）：

- `agents/<instance>/runtime/requests.jsonl`：client→server 的 JSON-RPC 请求（append-only）
- `agents/<instance>/runtime/events.jsonl`：server→client 的通知/事件（append-only）
- `agents/<instance>/runtime/stderr.log`：stderr 原样追加
- `agents/<instance>/session.json`：用于恢复/复盘的最小会话信息（至少包含 threadId、cwd、codexHome、recording paths）

#### Scenario: Requests and notifications are recorded
- **WHEN** adapter 运行并与 app-server 交互
- **THEN** `runtime/requests.jsonl` 与 `runtime/events.jsonl` 都被持续追加写入

### Requirement: Approval Requests Are Surfaced
当 app-server 发出需要 client 响应的请求（例如 approvals）时，adapter SHALL 将该请求作为一等事件暴露给上层，并提供 `respond(requestId, result)` 将用户决策回传给 app-server。

#### Scenario: Approval request can be responded
- **GIVEN** 一个回合触发了 approval request
- **WHEN** 上层通过 adapter 调用 `respond` 发送批准/拒绝
- **THEN** 回合继续执行或按拒绝语义终止
