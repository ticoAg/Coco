---
summary: "Delivery summary, verification, and impact notes"
doc_type: delivery
slug: "tui-message-refresh"
notes_dir: ".feat/20260120-1234-tui-message-refresh"
created_at_utc: "2026-01-20T12:34:43Z"
---
# Delivery Notes

> 使用与用户需求一致的语言填写本文档内容。

交付时的详细说明（最终会随 squash merge 合回 base 分支）。

## Changes
- 新增 Tauri 侧 session 文件监听，仅对 selected thread 生效，文件变更触发 `codex_thread_fs_update` 事件（含 500ms 去抖）。
- 前端接收文件变更事件后，按“2 分钟内 + 未归档(>1h)”过滤并触发 `thread/resume` 刷新。
- 本地 GUI 流式期间不刷新，记录 pending；流式结束后补一次刷新。
- 前后端补齐 watch 命令与类型定义。

## Expected outcome
- 外部客户端（codex tui）持续生成时，GUI 会话页能自动更新新增消息。
- GUI 本地流式不会被后台刷新打断；结束后能补一次最新刷新。

## How to verify
- Commands:
- 自动化：未执行（本次只给出手动路径）。
- Manual steps:
  1) `just dev` 启动 Coco；
  2) 用 codex tui 在同一 thread 持续生成；
  3) GUI 打开该 thread，观察自动刷新；
  4) GUI 内发起一次消息，流式期间外部继续写入，结束后自动补刷新；
  5) 进入 Archived 分组的会话，确认不触发刷新。

## Impact / risks
- 新增 `notify` 依赖；跨平台文件监听可能存在偶发丢事件或路径不稳定的风险。
- 若 watch 启动失败或 path 缺失，外部刷新将失效（不影响本地流式）。

## References (path:line)
- `apps/gui/src-tauri/src/thread_watch.rs:1`
- `apps/gui/src-tauri/src/lib.rs:2024`
- `apps/gui/src/api/client.ts:243`
- `apps/gui/src/features/codex-chat/CodexChat.tsx:1058`
