# Change: add-gui-codex-session-titles-and-task-actions

## Summary
在 GUI 的 Codex Chat（session tree）中补齐三个核心体验：

- **会话标题（title）**：当 codex app-server 只返回 `preview`（首条用户消息摘要）时，GUI 侧按规则提取生成一个短标题（自动：50 字），并把结果持久化到工作区目录（[`.agentmesh/`](../../../../.agentmesh)）以便下次打开仍可复用；支持手动改名（最多 50 字）。
- **Task 右键操作**：在左侧 session tree 的 `task` 节点支持右键菜单：Rename / Delete（以 `thread/archive` 语义实现）。
- **会话活跃/归档分组**：按最近 1h 活跃度区分 Active/Archived，并在 Archived 中按日期/小时分组；提供一键归档该层级所有 sessions 的入口。

## Why
- 当前 Codex app-server 的 `thread/list` 返回字段以 `preview` 为主（并非 AI 总结标题），导致 session tree 标题不稳定且不易扫描。
- 用户希望能像任务管理一样快速整理会话：重命名、归档/删除。
- “删除”采用 `thread/archive` 语义，避免直接物理删除 `~/.codex/sessions/*.jsonl` 带来的不可恢复风险。

## What Changes
- GUI 侧：
  - session tree 的 label 优先使用 `title`，fallback 到 `preview`。
  - `task` 节点右键菜单：Rename / Delete。
    - Rename：prompt 输入，写入本地 sidecar title（max 50）。
    - Delete：对该 `task` 节点及其后代 threads 逐个执行 `thread/archive`，并清理本地 sidecar。
  - session tree 增加 Active / Archived 分组：
    - 以 `updatedAtMs` 为“最后消息时间”，超过 1h 归为 Archived。
    - Archived 下按 `YYYY-MM-DD/HH` 分组展示。
    - 分组节点 hover 显示“一键归档”图标，点击后对该分组所有 threadId 调用 `thread/archive`，完成后刷新列表。
- Backend（Tauri）侧：
  - `codex_thread_list` 返回中为每个 thread 注入 `title`（来自 sidecar；若缺失则按规则生成并落盘）。
  - 提供新的 IPC 命令：
    - `codex_thread_title_set`：设置/覆盖 sidecar title（max 50，标记为 manual）。
    - `codex_thread_archive`：调用 codex app-server `thread/archive`，并删除 sidecar 文件（best-effort）。

## Non-Goals
- 不修改 `../codex` 仓库。
- 不引入额外 LLM 调用生成“AI 总结标题”（本 change 仅规则提取）。
- 不在本 change 中实现“彻底物理删除 rollout 文件”（仅 archive）。

## Data / Storage
- 手动标题 sidecar（per-workspace）：
  - 路径：`<workspace_root>/.agentmesh/codex/threads/<thread_id>.json`
  - 字段：`title`（string）、`source`（`manual`）、`updatedAtMs`（number|null）

## Impact
- Affected spec: `gui-codex-chat`
- Likely code modules (implementation stage):
  - Backend: [`apps/gui/src-tauri/src/lib.rs`](../../../../apps/gui/src-tauri/src/lib.rs)
  - Frontend:
    - [`apps/gui/src/types/codex.ts`](../../../../apps/gui/src/types/codex.ts)
    - [`apps/gui/src/api/client.ts`](../../../../apps/gui/src/api/client.ts)
    - [`apps/gui/src/components/CodexChat.tsx`](../../../../apps/gui/src/components/CodexChat.tsx)
    - `apps/gui/src/components/codex/sidebar/*`
