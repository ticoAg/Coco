---
summary: "Evidence-first context notes for hide-turn-scrollbar"
doc_type: context
slug: "hide-turn-scrollbar"
notes_dir: ".feat/20260120-0058-hide-turn-scrollbar"
created_at_utc: "2026-01-20T00:58:58Z"
---
# Context Notes

目标：记录最小但关键的上下文证据（入口、现状、约束、关键定位）。
要求：用 path:line 锚点，避免把大段日志贴进对话。

## Entrypoints
- apps/gui/src/features/codex-chat/codex/ActivityBlock.tsx:128 - Summary 行标题容器使用 `am-row-scroll`，是出现横向滚动条的直接入口。
- apps/gui/src/features/codex-chat/ui/turn/TurnWorkingItem.tsx:219 - Turn block 使用 `ActivityBlock` 且容器类为 `am-block-command`。
- apps/gui/src/features/codex-chat/codex/FileChangeEntryCard.tsx:37 - 变更列表条目同样使用 `am-row-scroll`。

## Current behavior
- apps/gui/src/index.css:208 - `am-row-scroll` 设置 `overflow-x: auto` 与 `white-space: nowrap`，并定义了 WebKit/Firefox 的细滚动条样式。

## Constraints / assumptions
- 仅保证 Chrome/Edge 隐藏滚动条（Firefox 维持现状）。
- 不触碰 `.am-shell-scroll` 等其他滚动样式。

## Related tests / fixtures
- 未发现直接相关测试。
