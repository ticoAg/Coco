# Design: add-codex-app-server-adapter

## Context
AgentMesh 的 Codex-first 路线需要一个稳定的底层接口：不解析 TUI/ANSI，而是直接消费结构化事件流。`codex app-server` 提供 thread/turn/item 的模型，非常适合做 adapter。

## Goals / Non-Goals
- Goals
  - 提供长期运行的 `codex app-server` 进程管理（spawn/shutdown）。
  - 把 JSON-RPC requests/notifications 原样落盘，形成可复盘证据链。
  - 把 approvals 作为一等事件暴露给 controller（映射为 gate.blocked）。
- Non-Goals
  - 不把“任务编排状态机”塞进 adapter；adapter 只管对接 Codex 与落盘。

## Decisions

### D1: Stdio JSON-RPC with explicit recording
adapter 负责：
- 对每个请求写入 `runtime/requests.jsonl`
- 对每个通知写入 `runtime/events.jsonl`
- stderr 追加写入 `runtime/stderr.log`

### D2: Per-agent CODEX_HOME isolation (default-on)
默认每个 agent instance 使用独立 `CODEX_HOME`（落在任务目录下），避免会话/缓存互相污染；需要共享历史时再显式选择共享 `CODEX_HOME`。

### D3: Compatibility handled in the client layer
Codex app-server 协议可能存在版本差异（字段/方法参数变化）。adapter client 层负责：
- 在启动后读取 `app-server` 提供的能力信息（若可用）或通过探测请求降级
- 对上层提供稳定的“语义 API”（fork/rollback/turn lifecycle）

## Risks / Trade-offs
- 长驻 app-server 进程需要处理 crash/restart；需要将“进程生命周期事件”也落盘。
- 若用户从 Finder 启动 GUI，PATH 可能缺失，需要支持显式 `AGENTMESH_CODEX_BIN`。

## Open Questions
- 是否需要支持“复用 GUI 的 app-server 进程”给 orchestrator（单例共享）？
- approvals 在不同 codex 版本里请求形态是否一致？是否需要做结构化 normalize？
