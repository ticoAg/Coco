# Change: update-gui-codex-chat-fork-rollback

## Summary
在 Coco GUI 的 Codex Chat 中接入 `thread/fork` 与 `thread/rollback`：

- fork：从当前会话派生新 thread，用于探索不同方向（fork 模式也可作为 subagent 的基础能力验证）。
- rollback：回退最近 N 个 turn 的会话历史，用于“减少主 thread 上下文污染”（注意：不回滚文件修改）。

## Why
- 你希望子任务尽量继承主线程对话历史（fork），同时又担心主线程吞入大量“打包上下文/派发过程”的 token；rollback 可以作为“清理历史”的手段。
- GUI 作为可视化入口，最适合用来验证 fork/rollback 的真实语义与边界（尤其是“只回滚历史，不回滚文件”）。

## What Changes
- 扩展 `gui-codex-chat` capability：新增 fork 与 rollback 的 UI/交互与行为约定。
- Tauri 后端需要提供 `thread/fork` 与 `thread/rollback` 的调用封装，并在切换 thread 后刷新会话与运行中指示。

## Non-Goals
- 不在本 change 中实现“多 agent 自动并行派发”；这里只做 Codex Chat 的会话管理能力补齐。
- 不要求实现任意 turn 精确回滚（MVP：rollback last N turns，默认 1）。

## Impact
- Affected specs: `gui-codex-chat`
- Affected code (implementation stage): [`apps/gui/src-tauri/src/lib.rs`](../../../../apps/gui/src-tauri/src/lib.rs), [`apps/gui/src-tauri/src/codex_app_server.rs`](../../../../apps/gui/src-tauri/src/codex_app_server.rs), `apps/gui/src/*`（会话 UI）
- Docs: [`docs/implementation-notes/codex-cli/app-server-api.md`](../../../../docs/implementation-notes/codex-cli/app-server-api.md) 需要把 thread/fork 与 thread/rollback 标记为“已接入”。
