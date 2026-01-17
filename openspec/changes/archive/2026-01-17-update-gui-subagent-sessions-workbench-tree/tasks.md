# Tasks: update-gui-subagent-sessions-workbench-tree

## 1. Spec
- [x] 1.1 在 `gui-subagent-sessions` spec delta 中新增 Workbench tree / 会话流历史 panel（events.jsonl：按时间排序 + 可过滤）/ file preview（Markdown/HTML）/ auto-follow 的行为约定。
- [x] 1.2 明确任务目录树的最小节点集合（MVP：shared/{state-board,human-notes,reports,evidence} + agents/<instance>/{session,runtime,artifacts}）。

## 2. Implementation
- [x] 2.1 前端：在 TaskDetail 增加 Workbench UI（树状导航 + 右侧预览）。
- [x] 2.2 前端：Agent 会话流历史 panel（基于 events.jsonl；按时间排序；支持过滤；MVP 仅 best-effort parse）。
- [x] 2.3 前端：file 节点预览（只读；Markdown 渲染；HTML 预览）。
- [x] 2.4 前端：auto-follow toggle（on：自动选中 running 且最近更新的 session；off：保留手动选择）。
- [x] 2.5 后端：补齐读取任务目录树所需的最小接口（安全路径约束，禁止越界）。

## 3. Validation
- [x] 3.1 `openspec validate update-gui-subagent-sessions-workbench-tree --strict`
