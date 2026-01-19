# Change: update-gui-subagent-sessions-workbench-tree

## Summary
把任务详情页的 “Subagents / Sessions” 从列表升级为更适合 multi-agent 的 **Workbench**：

- 提供类似文件管理器的树状结构（Task Directory tree：shared + agents + runtime + artifacts）
- 提供 subagent 会话流历史查看窗体（基于 `runtime/events.jsonl`：按时间排序 + 可过滤；并可查看 stderr/final）
- 提供 file 节点的只读查看 + 预览（支持 Markdown / HTML 预览）
- 提供 Auto-follow（自动聚焦当前活跃/运行中的 subagent session）开关
- （可选增强）对拥有 `session.json.vendorSession.threadId` 的 session：支持 “Open in Codex Workbench”（依赖 app-server pool）

## Why
- 当前 sessions 视图是 “列表 + tail events + final.json”，对于并发多个 subagent 时不够直观：
  - 很难快速定位：哪个 agent 在做什么、runtime 过程在哪里、关键产物在哪里
  - 缺少树状导航，无法把 shared/reports/evidence 与 agent runtime 形成整体工作台
- Artifacts-first 的核心是“任务目录 = 最终可迁移交付物”。Workbench 的本质是对任务目录的结构化浏览器。

## What Changes
- 扩展 `gui-subagent-sessions`：
  - Workbench tree：把 `shared/` 与 `agents/<instance>/` 的关键文件映射为节点
  - Runtime viewer：支持查看 subagent 会话流历史（MVP：events.jsonl tail + refresh + 按时间排序 + 过滤；增强：按 JSON 字段过滤）
  - File preview：file 节点支持 Markdown / HTML 预览（只读）
  - Auto-follow：当存在 running session 时，自动选中最近活跃的 session（可关闭）
- 为后续与 Codex Chat/Collab Workbench 打通预留入口：
  - 如果 `agents/<instance>/session.json` 含 `vendorSession.threadId` + `codexHome`，GUI 可通过 app-server pool 打开该 thread 进行 fork/resume（本 change 可只做 UI 入口/不实现底层）

## Non-Goals
- 不在本 change 中实现 Controller GUI（spawn/cancel/join 的按钮体系仍保持最小只读）。
- 不在 MVP 中支持文件编辑（仅查看/预览）。
- 不在本 change 中解析/重建所有 vendor 事件为统一 schema（MVP 先做到“可读/可定位/可刷新”）。

## Impact
- Affected spec: `gui-subagent-sessions`
- Related docs:
  - `docs/agentmesh/gui.md`（3.1 Subagents / Sessions 展示建议）
  - `docs/agentmesh/execution.md`
  - `WORKBENCH_STATE_FLOW.md` / `docs/implementation-notes/agentmesh/workbench-state-flow.md`
- Likely code modules (implementation stage):
  - Frontend:
    - `apps/gui/src/components/TaskDetail.tsx`（sessions tab → workbench）
    - `apps/gui/src/hooks/useTasks.ts`（sessions 数据源/轮询）
    - `apps/gui/src/components/*`（新增 WorkbenchTree / RuntimeViewer 组件）
  - Backend:
    - `apps/gui/src-tauri/src/lib.rs`（新增 task-dir tree/list/read 命令或复用现有接口）
