# Design: update-codex-app-server-adapter-pool

## Decision: pool key
MVP 以 `codexHome` 作为 pool key，理由：
- `CODEX_HOME` 是 codex sessions/rollouts 的主要数据隔离维度；不同 home 下的 thread 集合互不相干。
- GUI 希望同时查看多个 agent instance 的会话（每个 instance 有独立 codex_home）。

扩展项（后续再做）：
- `profile`：同一 codexHome 下可能需要不同 profile 的模型配置（GUI 已支持 profile selector）。
- `cwd`：同一 codexHome 下不同 cwd 可能影响工具执行路径；但 thread 本身也携带 cwd，可先不做 pool 维度。

## Decision: appServerId
为每个 `codex app-server` 进程实例分配 `appServerId`（opaque string）。上层调用必须携带 `appServerId`（避免与 MCP tool call 中的 `server` 字段混淆）：
- 避免 “threadId 在不同 codexHome 下可能重叠” 的歧义
- 使 GUI 可以同时订阅多个 app-server 的事件流并正确路由到 panel

## Risk: GUI 事件路由复杂度
pool 会引入多个事件源。为降低复杂度：
- 后端统一对外 emit：`{ appServerId, kind, message }`
- 前端 state 以 `(appServerId, threadId)` 作为 key
