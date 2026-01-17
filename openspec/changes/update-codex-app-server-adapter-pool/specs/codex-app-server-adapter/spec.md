## ADDED Requirements

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
