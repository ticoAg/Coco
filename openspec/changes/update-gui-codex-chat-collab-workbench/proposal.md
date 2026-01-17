# Change: update-gui-codex-chat-collab-workbench

## Summary
在 AgentMesh GUI 的 Codex Chat 中补齐 **collab 多 agent 可视化 + workbench 多 panel 模式**：

- 渲染 `CollabAgentToolCall` 的过程与状态（collab tools: `spawn_agent`/`send_input`/`wait`/`close_agent`；item 字段 `tool`: `spawnAgent`/`sendInput`/`wait`/`closeAgent`）
- 从 collab 工具调用中推导 thread graph（root thread → orchestrator thread → worker threads）
- 提供 “pin orchestrator + 切换 worker panels” 的多面板交互
- 提供 Auto-focus（自动聚焦当前 running 的 agent/thread）开关
- 在 workbench 中支持对任意 thread 执行 fork，并在树上呈现分支关系

## Why
- 你希望在探索新 repo 时稳定触发多 agent，并且 **主线程不被过程噪声淹没**。  
  但当前 GUI 只能以单 thread 方式浏览，且不展示 collab tool call，使得“多 agent 发生了什么/哪个 worker 在跑/结果在哪”不直观。
- Codex app-server 协议已把 collab 作为一等 item（`CollabAgentToolCall`），GUI 只需要把它呈现出来，并提供多 panel 路由即可。

## What Changes
- `gui-codex-chat` 扩展：
  - 支持识别与渲染 `CollabAgentToolCall` item（展示 tool/status/sender/receivers/agentsStates/prompt）
  - “Collab Workbench” 视图：
    - 左侧 thread tree（root/orchestrator/worker threads + fork branches）
    - 右侧多 panel：pin orchestrator，worker panels 可切换/并排
    - Auto-focus：根据 running 状态自动切换 panel（可关闭）
  - fork：
    - 在任意 panel 上支持 `thread/fork`
    - GUI 在 thread tree 中记录并显示 fork 关系（优先从 app-server 返回值构建；必要时 GUI 自己维护映射）

## Non-Goals
- 不在本 change 中实现完整 “AgentMesh Task Directory Workbench”（另一个 change 做）。
- 不在本 change 中实现自动生成 Orchestrator actions / Controller loop 的 GUI 控制面（先把可视化跑通）。

## Impact
- Affected spec: `gui-codex-chat`
- Related docs:
  - `docs/agentmesh/gui.md`（2.3 Codex Chat）
  - `docs/agentmesh/multiagent.md`（4 Fork vs Spawn / 8 GUI）
  - `docs/implementation-notes/codex-cli/app-server-api.md`
  - `codex/codex-rs/app-server-protocol/src/protocol/v2.rs`（`CollabAgentToolCall` item 定义，仅参考）
- Likely code modules (implementation stage):
  - Frontend:
    - `apps/gui/src/components/CodexChat.tsx`（事件路由、workbench UI）
    - `apps/gui/src/types/codex.ts`（新增 collab item union type）
    - `apps/gui/src/components/codex/*`（TurnBlock / Sidebar / 新 Workbench 组件）
  - Backend:
    - `apps/gui/src-tauri/src/codex_app_server.rs`（notifications 透传；必要时补充字段）
    - `apps/gui/src-tauri/src/lib.rs`（如需新增/扩展命令）
