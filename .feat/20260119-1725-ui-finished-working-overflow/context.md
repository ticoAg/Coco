---
summary: "Evidence-first context notes for ui-finished-working-overflow"
doc_type: context
slug: "ui-finished-working-overflow"
notes_dir: ".feat/20260119-1725-ui-finished-working-overflow"
created_at_utc: "2026-01-19T17:25:40Z"
---
# Context Notes

> 使用与用户需求一致的语言填写本文档内容。

目标：记录最小但关键的上下文证据（入口、现状、约束、关键定位）。
要求：用 path:line 锚点，避免把大段日志贴进对话。

## Entrypoints
- “Finished working” 展开入口与渲染工作项：`apps/gui/src/features/codex-chat/codex/TurnBlock.tsx:270`。
- 工作项为命令时用 `ActivityBlock` 渲染摘要/详情：`apps/gui/src/features/codex-chat/ui/turn/TurnWorkingItem.tsx:168`。
- 命令摘要内容可能直接包含原始 command：`apps/gui/src/features/codex-chat/codex/utils/command-parser.ts:240`。

## Current behavior
- 展开后会渲染 `turn.workingItems`（包含 command 类型）：`apps/gui/src/features/codex-chat/codex/TurnBlock.tsx:289`。
- command 摘要直接来自 `getCmdSummary(..., rawCommand)`，`titleContent` 可能为完整 shell 命令：`apps/gui/src/features/codex-chat/ui/turn/TurnWorkingItem.tsx:168`。
- 摘要行使用 `am-row-title` + `truncate` 且在 flex 行内展示：`apps/gui/src/features/codex-chat/codex/ActivityBlock.tsx:127`。

## Constraints / assumptions
- 主聊天列是 flex item，但当前缺少 `min-w-0`，长的不可换行文本可能推高最小宽度：`apps/gui/src/features/codex-chat/CodexChat.tsx:3928`。
- 摘要文本来自长命令时（例如多行/长参数），展开“Finished working”才会出现，因此问题只在展开时触发。

## Related tests / fixtures
- 未发现直接相关的前端测试用例（待补充）。
