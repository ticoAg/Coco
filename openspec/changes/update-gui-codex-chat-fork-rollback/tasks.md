# Tasks: update-gui-codex-chat-fork-rollback

## 1. Spec
- [ ] 1.1 在 `gui-codex-chat` spec delta 中新增 fork/rollback 的行为与场景。

## 2. Implementation
- [ ] 2.1 Tauri: 新增 `codex_thread_fork` 命令（调用 app-server `thread/fork`）。
- [ ] 2.2 Tauri: 新增 `codex_thread_rollback` 命令（MVP：支持 `numTurns=1` 或等价语义）。
- [ ] 2.3 Frontend: 会话标题栏/菜单新增 Fork 与 Rollback 操作，并在 turn 运行中时做确认或禁用。
- [ ] 2.4 切换后刷新：fork 创建新 thread 后自动打开该 thread；rollback 后重新 resume/刷新 turns。
- [ ] 2.5 更新文档：`docs/implementation-notes/codex-cli/app-server-api.md`。

## 3. Validation
- [ ] 3.1 `openspec validate update-gui-codex-chat-fork-rollback --strict`
- [ ] 3.2 `npm -C apps/gui run build`（或对应 GUI 的构建校验）
