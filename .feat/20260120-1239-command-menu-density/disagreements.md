---
summary: "Decision log for disagreements and trade-offs"
doc_type: disagreements
slug: "command-menu-density"
notes_dir: ".feat/20260120-1239-command-menu-density"
created_at_utc: "2026-01-20T12:39:14Z"
---
# Disagreement Log

> 使用与用户需求一致的语言填写本文档内容。

当需求/方案存在分歧时，用这里显式记录，并给出选项与 trade-off（然后停下等用户选择）。

- Topic: 调整范围（是否影响所有复用 MENU_STYLES 的菜单）
  - Option A: 全局调整 `MENU_STYLES`（`menu-styles.ts`）
    - Pros: 一致性最好；改动最小；后续维护简单
    - Cons: 可能影响 StatusBar 等其它菜单的密度/观感，需要额外验收
  - Option B: 仅聊天输入框 Popup Menu 局部调整（为 `CodexChatComposer`/`SlashCommandMenu` 引入“紧凑版”样式）
    - Pros: 影响范围可控；不会意外改变其它菜单
    - Cons: 会出现两套密度样式；未来复用/一致性需要注意
  - Decision: Option A（用户确认：1A）
  - Notes: 当前定位显示 `MENU_STYLES` 被 `SlashCommandMenu`/`SkillMenu`/`StatusBar` 等多处复用（见 `.feat/.../context.md`）。

- Topic: Popup Menu 最大高度（listContainer max-height）
  - Option A: `max-h-[240px]` -> `max-h-[320px]`（提升但相对保守）
  - Option B: `max-h-[240px]` -> `max-h-[360px]` 或改为相对视口（例如 `max-h-[40vh]`）
  - Decision: Option B（用户确认：2B）
  - Notes:
    - 用户期望“最大可提供 11 个选项”的容器上限；最小值按实现侧合理收敛。
    - 落地方案：`max-h-[min(308px,40vh)]`（`308px = 11 * 28px`）。

- Topic: 条目紧凑程度（行高/控件尺寸）
  - Option A: 仅调整菜单项 padding（例如 `py-1.5` -> `py-1`），其它保持不变（变化更小）
  - Option B: 在 Option A 基础上，进一步缩小 `gap` / icon / Pin 按钮（更紧凑但更易感知变化）
  - Decision: Option B（用户确认：3B）
  - Notes: 实现会同时调整 `MENU_STYLES`（行高/gap/icon）以及 `SlashCommandMenu` 内 Pin 按钮尺寸。
