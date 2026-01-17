# Tasks: update-gui-codex-chat-collab-workbench

## 1. Spec
- [ ] 1.1 在 `gui-codex-chat` spec delta 中新增 collab workbench 的 UI/行为约定（thread graph / panels / auto-focus / fork）。
- [ ] 1.2 明确 orchestrator thread 的推导规则与兜底策略（例如：root thread 第一次 `CollabAgentTool.SpawnAgent` 的 `receiverThreadIds[0]` 视为 orchestrator）。

## 2. Implementation
- [ ] 2.1 前端 types：在 `CodexThreadItem` union 中加入 `collabAgentToolCall` 类型。
- [ ] 2.2 前端渲染：Working 区域支持渲染 collab tool call（并展示 agent states）。
- [ ] 2.3 Workbench UI：
  - [ ] thread tree（root/orchestrator/worker threads + fork branches）
  - [ ] multi-panel（pin orchestrator；workers 可切换/并排）
  - [ ] auto-focus toggle（开/关）
- [ ] 2.4 事件路由：支持多个 thread 并行更新（不再仅依赖 `selectedThreadId` 过滤）。
- [ ] 2.5 fork：workbench 中对任意 panel 支持 fork，并更新 tree + 打开新 thread。

## 3. Validation
- [ ] 3.1 `openspec validate update-gui-codex-chat-collab-workbench --strict`
- [ ] 3.2 `npm -C apps/gui run build`
