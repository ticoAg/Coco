---
summary: "Delivery summary, verification, and impact notes"
doc_type: delivery
slug: "ui-finished-working-overflow"
notes_dir: ".feat/20260119-1725-ui-finished-working-overflow"
created_at_utc: "2026-01-19T17:25:40Z"
---
# Delivery Notes

> 使用与用户需求一致的语言填写本文档内容。

交付时的详细说明（最终会随 squash merge 合回 base 分支）。

## Changes
- 为工作项摘要行加入横向滚动容器，保持单行显示不撑宽（ActivityBlock）。
- FileChange 头部路径改为横向滚动容器，避免长路径撑宽。
- 主聊天列补 `min-w-0`，允许 flex 子项收缩。
- 新增 `am-row-scroll` 样式（横向滚动 + 细滚动条）。

## Expected outcome
- 展开“Finished working”后聊天列宽度不被长命令/长路径撑开。
- 工作区块摘要行默认单行，需查看完整内容时可左右滚动。

## How to verify
- Status:
  - 未执行（用户确认无需验证）。
- Commands (if needed):
  - `just dev`
- Manual steps (if needed):
  - 打开包含长命令/长路径的对话，展开“Finished working”。
  - 确认聊天列宽度稳定，摘要行可水平滚动查看完整文本。

## Impact / risks
- UI 行为变化：摘要不再截断，出现水平滚动条。

## References (path:line)
- apps/gui/src/features/codex-chat/codex/ActivityBlock.tsx:127
- apps/gui/src/features/codex-chat/codex/FileChangeEntryCard.tsx:36
- apps/gui/src/features/codex-chat/CodexChat.tsx:3928
- apps/gui/src/index.css:208
