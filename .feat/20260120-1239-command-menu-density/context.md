---
summary: "Evidence-first context notes for command-menu-density"
doc_type: context
slug: "command-menu-density"
notes_dir: ".feat/20260120-1239-command-menu-density"
created_at_utc: "2026-01-20T12:39:14Z"
---
# Context Notes

> 使用与用户需求一致的语言填写本文档内容。

目标：记录最小但关键的上下文证据（入口、现状、约束、关键定位）。
要求：用 `path:line` 锚点，避免把大段日志贴进对话。

## Entrypoints
- apps/gui/src/features/codex-chat/ui/CodexChatComposer.tsx:249 - Popup Menu 的共享容器（+ / / / $）在这里渲染与开关
- apps/gui/src/features/codex-chat/ui/CodexChatComposer.tsx:274 - Popup Menu 外层容器 class：`MENU_STYLES.popoverPosition + MENU_STYLES.popover`
- apps/gui/src/features/codex-chat/ui/CodexChatComposer.tsx:392 - 列表滚动容器 class：`MENU_STYLES.listContainer`
- apps/gui/src/features/codex-chat/codex/styles/menu-styles.ts:8 - 菜单项密度（行高/gap/leading）：`MENU_STYLES.popoverItem`/`popoverItemActive`
- apps/gui/src/features/codex-chat/codex/styles/menu-styles.ts:23 - 列表最大高度：`MENU_STYLES.listContainer`（`308px = 11 * 28px`，并用 `40vh` 作为小屏收敛）
- apps/gui/src/features/codex-chat/codex/SlashCommandMenu.tsx:165 - Pin 按钮尺寸（`h-5 w-5`），会影响行内元素“紧凑感”

## Current behavior
- Popup Menu 的列表滚动容器为 `max-h-[min(308px,40vh)] overflow-auto`，即最多约 11 个选项高度后开始滚动（`MENU_STYLES.listContainer`）。
- 菜单项按钮为固定行高 `h-7`，并缩小 `gap/icon/Pin`，整体更紧凑（`MENU_STYLES.popoverItem`/`popoverItemActive`）。
- `MENU_STYLES` 在多个组件中复用（`SlashCommandMenu`/`SkillMenu`/`StatusBar` 等），直接修改会产生跨处影响。

## Constraints / assumptions
- 项目使用 Tailwind utility class；优先通过调整 class string 达成目标，避免引入额外 CSS 文件。
- 密度样式目前是“共用”的：若要只影响聊天 Popup Menu，需要引入局部 override 或新增一套 styles。

## Related tests / fixtures
- 暂未定位到直接覆盖该 UI 的测试（后续实现阶段可再补充检索）。
