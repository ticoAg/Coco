---
summary: 输入框 skill 标签占列 - 上下文证据
doc_type: context
slug: input-skill-column
notes_dir: .feat/20260120-0455-input-skill-column
created_at_utc: 2026-01-20T04:55:28Z
---
# 上下文记录

目标：记录最小但关键的上下文证据（入口、现状、约束、关键定位）。
要求：用 path:line 锚点，避免把大段日志贴进对话。

## Entrypoints
- apps/gui/src/features/codex-chat/CodexChat.tsx:3874 - CodexChatComposer 渲染入口。
- apps/gui/src/features/codex-chat/ui/CodexChatComposer.tsx:467 - 输入区域（skill/prompt 标签 + textarea）定义位置。

## Current behavior (code)
- apps/gui/src/features/codex-chat/ui/CodexChatComposer.tsx:468 - 输入区域容器使用 flex + flex-wrap + items-start + gap-1.5。
- apps/gui/src/features/codex-chat/ui/CodexChatComposer.tsx:475 - selectedSkill 渲染为 inline-flex shrink-0 标签。
- apps/gui/src/features/codex-chat/ui/CodexChatComposer.tsx:481 - textarea 使用 flex-1 与 min-w-[100px]，与标签同容器内布局。
- issue #18 截图：skill/prompt block 在输入区域内出现单独占列/换行（用户反馈）。

## Implementation (this change)
- apps/gui/src/features/codex-chat/ui/CodexChatComposer.tsx:468 - prompt/skill 标签改为 min-w-0，textarea 改为 min-w-0，避免标签强制占列并允许自然换行。

## Constraints / assumptions
- 现有注释标明 inline tags for skill/prompt，应保持同一输入区域内渲染方式。
- 变更应限于布局/样式层面，不调整 skill 选择/发送逻辑。

## Related tests / fixtures
- 暂未发现与输入框布局相关的专用测试。
