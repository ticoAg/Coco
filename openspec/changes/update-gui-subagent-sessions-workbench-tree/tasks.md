# Tasks: update-gui-subagent-sessions-workbench-tree

## 1. Spec
- [ ] 1.1 在 `gui-subagent-sessions` spec delta 中新增 Workbench tree / runtime viewer / auto-follow 的行为约定。
- [ ] 1.2 明确任务目录树的最小节点集合（MVP：shared/{state-board,human-notes,reports,evidence} + agents/<instance>/{session,runtime,artifacts}）。

## 2. Implementation
- [ ] 2.1 前端：在 TaskDetail 增加 Workbench UI（树状导航 + 右侧预览）。
- [ ] 2.2 前端：runtime viewer（events/stderr/final）支持 tail/refresh；增强：搜索/过滤。
- [ ] 2.3 前端：auto-follow toggle（on：自动选中 running 且最近更新的 session；off：保留手动选择）。
- [ ] 2.4 后端：补齐读取任务目录树所需的最小接口（安全路径约束，禁止越界）。
- [ ] 2.5 （可选）对 session.json 含 threadId 的 session 增加 “Open in Codex Workbench” 入口（依赖 `update-codex-app-server-adapter-pool`）。

## 3. Validation
- [ ] 3.1 `openspec validate update-gui-subagent-sessions-workbench-tree --strict`
- [ ] 3.2 `npm -C apps/gui run build`

