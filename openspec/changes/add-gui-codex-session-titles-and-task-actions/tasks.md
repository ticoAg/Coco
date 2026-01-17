# Tasks: add-gui-codex-session-titles-and-task-actions

## 1. Spec
- [x] 1.1 在 `gui-codex-chat` spec delta 中新增：会话标题 sidecar（auto 15 / manual 50）、task 右键 Rename/Delete(archive) 的行为约定与场景。

## 2. Implementation
- [x] 2.1 后端：新增 thread title sidecar 读写（`.agentmesh/codex/threads/<thread_id>.json`）。
- [x] 2.2 后端：`codex_thread_list` 注入 `title`（sidecar 优先；缺失则按规则生成 25 字并落盘）。
- [x] 2.3 后端：新增 Tauri 命令 `codex_thread_title_set`（max 50，manual）与 `codex_thread_archive`（调用 `thread/archive` 并清 sidecar）。
- [x] 2.4 前端：类型更新（`CodexThreadSummary.title`），session tree label 优先 `title`。
- [x] 2.5 前端：task 节点右键菜单（Rename / Delete），调用新 API；Delete 归档当前 task 节点及其所有后代 threads。

## 3. Validation
- [x] 3.1 `openspec validate add-gui-codex-session-titles-and-task-actions --strict`
- [x] 3.2 `cargo test`
- [x] 3.3 `npm -C apps/gui run build`（若本机依赖可用）
