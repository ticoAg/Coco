# Change: update-codex-app-server-adapter-pool

## Summary
为 `codex-app-server-adapter` 补齐 **pool 模式**：支持同时维护多个 `codex app-server` 进程实例（按 `CODEX_HOME` 维度隔离/复用），并为上层（GUI/Controller）提供可路由的 `appServerId` 句柄（避免与 Codex 协议中的 MCP `server` 概念混淆）。

> 背景：我们不修改 `./codex` 源码，只在 AgentMesh 侧实现 adaptor / manager。

## Why
- 目前 GUI 的 Codex Chat 默认只启动**单一** `codex app-server`，且默认使用 `~/.codex` 作为数据目录。  
  这导致无法在同一 GUI 中“可靠地打开/操作”多个不同 `CODEX_HOME` 下的 thread（例如 Task Directory 里每个 `agents/<instance>/codex_home/`）。
- multi/subagent 方案里我们推荐 **per-agent CODEX_HOME**（隔离 sessions/rollouts/cache）。要在 GUI 里查看与操作这些会话（fork/resume/turn/审批），就需要 app-server pool。

## What Changes
- 在 adapter 能力层面定义：
  - **pool key**：最小以 `codexHome` 区分（可扩展：`profile` / `cwd`）。
  - **appServerId**：每个 app-server 实例的稳定句柄，上层所有请求都带 `appServerId`，避免 threadId 跨 home 的歧义。
  - **事件携带来源**：streaming events 需要能标识来自哪个 app-server 实例（用于 GUI 多 panel 路由）。
- 在实现层面（预计落点）：
  - GUI Tauri backend 增加 `CodexAppServerPool`（或同等模块），集中管理多个 `codex app-server` 子进程。
  - Spawn 时显式设置 `CODEX_HOME=<codexHome>`（默认回退 `~/.codex`）。

## Non-Goals
- 不在本 change 中实现 GUI 的 collab workbench UI（另一个 change 做）。
- 不在本 change 中改变 Task Directory 的落盘结构（保持现状）。

## Impact
- Affected spec: `codex-app-server-adapter`
- Related docs:
  - `docs/agentmesh/execution.md`
  - `docs/agentmesh/gui.md`（2.3 Codex Chat / 3.1 Subagents）
  - `docs/implementation-notes/codex-cli/app-server-api.md`
- Likely code modules (implementation stage):
  - `apps/gui/src-tauri/src/codex_app_server.rs`（spawn / events）
  - `apps/gui/src-tauri/src/lib.rs`（Tauri commands: thread/turn/config/…）
  - `apps/gui/src/components/CodexChat.tsx`（需要能区分 server 来源的事件）
