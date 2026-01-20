---
summary: "Feature requirements and validation scope for command-menu-density"
doc_type: requirements
slug: "command-menu-density"
notes_dir: ".feat/20260120-1239-command-menu-density"
base_branch: "dev"
feature_branch: "feat/command-menu-density"
worktree: "../Coco-feat-command-menu-density"
created_at_utc: "2026-01-20T12:39:14Z"
---
# Feature Requirements: command-menu-density

> 使用与用户需求一致的语言填写本文档内容。

## Status
- Current: vFinal
- Base branch: dev
- Feature branch: feat/command-menu-density
- Worktree: ../Coco-feat-command-menu-density
- Created (UTC): 2026-01-20T12:39:14Z

## v0 (draft) - 2026-01-20T12:39:14Z

### Goals
- 提高聊天输入框上方 Popup Menu（+ / $）的可视高度：在不滚动的情况下展示更多条目。
- 让 Popup Menu 内的条目（button 行）更紧凑：在保持可读性/可点击性的前提下，降低每行高度。
- 不改变现有交互行为（hover/highlight/键盘上下移动/Enter 选择/Tab 补全等）。

### Non-goals
- 不改动菜单的数据源、筛选逻辑、排序逻辑与快捷键逻辑。
- 不引入全新的样式系统（优先在现有 Tailwind class / MENU_STYLES 上做增量调整）。
- 不做大范围 UI 重构（例如布局重排、文案改写、图标体系调整）。

### Acceptance criteria
- Popup Menu 的滚动容器最大高度相较当前（`240px`）更高；能明显展示更多项目后再出现滚动条。
- 单条菜单项行高更低（主要体现在 padding/控件尺寸更紧凑），整体更“密”。
- Hover/active（高亮）样式不回归；图标、文字、描述对齐正常，不出现裁剪/溢出。
- 若本次改动会影响到其它复用 `MENU_STYLES` 的菜单（例如 StatusBar 的下拉菜单），需明确是否在预期内，并手动验收通过。

### Open questions
1) 这次“高度更高 + 更紧凑”的调整范围希望是：
   - 仅聊天输入框的 Popup Menu（`CodexChatComposer` 内的共享容器，涵盖 + / / / $）
   - 还是全局所有复用 `MENU_STYLES` 的 popover（可能包含 StatusBar 等其它菜单）
2) 期望的最大高度是固定值还是相对视口？
   - 固定值（例如 `max-h-[320px]` / `max-h-[360px]`）
   - 相对值（例如 `max-h-[40vh]`，在大屏更高，小屏自动收敛）
3) “更紧凑”的力度：
   - 仅减少菜单项的 `py`（例如 `py-1.5 -> py-1`）
   - 同时缩小 gap/icon/Pin 按钮尺寸（更紧凑但视觉变化更明显）

### Options / trade-offs
- Option A：直接调整 `MENU_STYLES`（改一处，多处生效）
  - 优点：风格统一；改动小；可复用处一致变更。
  - 缺点：可能波及 StatusBar 等其它菜单（需要确认是否期望一起变更）。
- Option B：为聊天 Popup Menu 引入“紧凑版”样式（仅对 `CodexChatComposer`/`SlashCommandMenu` 生效）
  - 优点：影响范围可控，不会误伤其它菜单。
  - 缺点：会出现两套密度样式；未来维护需要注意一致性/复用策略。

### Verification plan
- Unit tests:
- Integration tests:
- Manual steps:
  - 打开聊天输入框的 Popup Menu（+ / / / $），确认容器更高、条目更紧凑、滚动正常。
  - 用键盘上下/Enter/Tab/ESC 走一遍关键交互，确认无回归。
  - 如选择 Option A：打开 StatusBar 相关 popover，确认视觉与可用性无回归。

## vFinal - 2026-01-20

### Confirmed decisions
- Scope: 全局调整 `MENU_STYLES`（用户选择 1A）
- Max height: 列表滚动容器以“最多显示约 11 个选项”为上限（用户选择 2B）
  - 具体落地：`max-h-[min(308px,40vh)]`（`308px = 11 * 28px`，小屏自动收敛）
- Density: 更紧凑（用户选择 3B）
  - 菜单项：固定行高（`h-7`）、缩小 gap
  - 图标：`iconSm` 从 `3.5` 调整为 `3`
  - Pin：缩小点击区域与 icon

### Acceptance (re-validated)
- Popup Menu 不滚动时可展示更多条目（目标约 11 个可点击选项上限）
- 条目更紧凑但仍可读/可点
- 交互不回归（hover/highlight/键盘导航/Enter/Tab/ESC）

### Verification plan
- `apps/gui`：
  - `npm run typecheck`
  - `npm run lint`
  - 手动打开 + / / / $ 菜单与 StatusBar 下拉菜单做回归检查

> 在用户确认后补齐，并标注确认日期/版本差异。
