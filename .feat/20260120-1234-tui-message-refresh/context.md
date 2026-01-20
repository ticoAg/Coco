---
summary: "Evidence-first context notes for tui-message-refresh"
doc_type: context
slug: "tui-message-refresh"
notes_dir: ".feat/20260120-1234-tui-message-refresh"
created_at_utc: "2026-01-20T12:34:43Z"
---
# Context Notes

> 使用与用户需求一致的语言填写本文档内容。

目标：记录最小但关键的上下文证据（入口、现状、约束、关键定位）。
要求：用 path:line 锚点，避免把大段日志贴进对话。

## Entrypoints
- `apps/gui/src/features/codex-chat/CodexChat.tsx:964` 选择会话时调用 `codexThreadResume` 并重建 timeline。
- `apps/gui/src/features/codex-chat/model/useCodexJsonRpcEvents.ts:51` 监听 `codex_app_server` 事件作为实时更新入口。
- `apps/gui/src-tauri/src/thread_watch.rs:1` 监听 selected thread 的 session 文件变更并推送 `codex_thread_fs_update` 事件。
- `apps/gui/src-tauri/src/lib.rs:2024` 暴露 `codex_thread_watch_start/stop` 命令给前端。
- `apps/gui/src/features/codex-chat/CodexChat.tsx:3459` 前端启动/停止 watcher 并接收文件事件刷新。

## Current behavior
- `apps/gui/src/features/codex-chat/model/useCodexJsonRpcEvents.ts:84` 通知按 `selectedThreadId` 过滤，非当前会话的事件直接忽略。
- `apps/gui/src/features/codex-chat/CodexChat.tsx:727` 会话列表仅在最近 30s 有更新时开启 7s 轮询刷新；仅更新列表，不刷新当前会话内容。
- `apps/gui/src-tauri/src/lib.rs:1768` `thread/list` 用 session 文件修改时间生成 `updatedAtMs`，可反映外部客户端写入。
- `apps/gui/src/features/codex-chat/CodexChat.tsx:1058` 仅在“2 分钟内 + 未归档”条件满足时允许外部刷新。
- `apps/gui/src/features/codex-chat/CodexChat.tsx:3487` 本地流式期间仅记录 pending，结束后补一次刷新。

## Constraints / assumptions
- `apps/gui/src-tauri/src/lib.rs:1937` `thread/resume` 通过 GUI 自己的 app-server 请求数据，不会自动接收其他进程的实时事件。
- `apps/gui/src-tauri/src/codex_rollout_restore.rs:917` `thread/resume` 会读取 rollout `.jsonl` 补全/恢复历史，重复调用可刷新磁盘新增内容。

## Related tests / fixtures
- 暂未发现与“跨客户端实时刷新”直接相关的测试。
