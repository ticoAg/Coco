# AgentMesh GUI × Codex VSCode 插件 UI/UX 复刻：样式映射与组件骨架

本目录用于把「AgentMesh GUI」在 UI/UX 上向「Codex VSCode 插件 Webview」靠齐的实现方案沉淀下来，便于后续同事接力扩展。

> 参考资料入口：`docs/implementation-notes/codex-vscode-plugin/`（你已经从 `plugin-index.js` 里抽象了折叠结构/卡片骨架/动画参数等）。

---

## 1. 需求与目标

### 1.1 需求（来自产品/开发）

- 希望 AgentMesh GUI 的页面内容整体参考复刻 VSCode 插件：Codex 的 UI/UX 样式（暗色材质、层级、密度、卡片、折叠交互、hover 反馈）。
- 本期只做：`CodexChat` 页面。
- 引入 `framer-motion` 来对齐 Codex 插件的 accordion 动画手感。
- 主题系统改为：CSS variables + Tailwind 引用变量（更接近 VSCode token 体系）。
- 需要一份“样式映射/组件骨架说明”，包含：需求、本次计划、映射方案、组件骨架、TODO list、本期计划、后续任务。

### 1.2 本期目标（可验收）

- Turn 内有清晰的层级：
  - 用户输入
  - Working/Thinking（过程性输出：exec/read/mcp/plan/system/reasoning）折叠区
  - 最终回复
- 折叠动画手感对齐 Codex 插件（`duration: 0.3` + `ease: [0.19, 1, 0.22, 1]`）。
- 过程性输出以统一的“卡片/边框/背景/阴影/hover”风格呈现。
- tokens 能通过 CSS variables 统一调参，Tailwind class 只引用语义 token（避免硬编码色值散落）。

### 1.3 非目标（本期不做）

- 不做其它页面（`TaskList` / `TaskDetail` / `NewTaskModal`）的完整 UI 迁移。
- 不做 VSCode 插件中更复杂的“Exploration Accordion / 文件树 / Diff Review 面板”整套复刻（留给后续任务）。

---

## 2. 本次改动落点（当前实现）

### 2.1 全局主题（CSS variables + Tailwind token）

- CSS variables 定义：`apps/gui/src/index.css`
  - 以 `--am-` 前缀命名。
  - 颜色存为 `r g b` 三元组，便于 Tailwind 使用 `rgb(var(--x) / <alpha-value>)` 支持 `/70` 这类透明度。
- Tailwind token 映射：`apps/gui/tailwind.config.ts`
  - `bg.* / text.* / border.* / status.* / token.*` 都改为引用 CSS variables。
  - 菜单/弹出层使用 `shadow-menu`，卡片使用 `shadow-card`，两者由 CSS variables 控制。

### 2.2 Accordion 动画（framer-motion）

- 通用折叠组件：`apps/gui/src/components/ui/Collapse.tsx`
- 动画常量：`ACCORDION_TRANSITION`
  - `duration: 0.3`
  - `ease: [0.19, 1, 0.22, 1]`

### 2.3 CodexChat Turn 层级折叠

- 页面：`apps/gui/src/components/CodexChat.tsx`
- Turn 渲染时把 entries 分为：
  - `userEntries`：用户输入（右侧气泡）
  - `workingEntries`：过程性输出（工具/推理/系统提示等）——折叠区
  - `assistantMessageEntries`：最终回复（默认展开）

### 2.4 Working 区域紧凑展示（Timeline row）

为了避免“AI 过程性输出”在展开后占用过多高度，Working 区域条目采用 Codex 插件风格的紧凑行：

- 默认仅显示 1 行摘要（`Ran ...` / `Edited ...` / `MCP ...` / `Thinking` / system notice）。
- 点击摘要行才展开详情区（命令输出 / diff / reasoning markdown 等）。
- 样式类在 `apps/gui/src/index.css`：`.am-row` / `.am-row-hover` / `.am-row-title`，强调“轻 hover + 标题轻微提亮”，避免明显分割线与厚重卡片区域。
- Working 列表采用极小间距（`space-y-0`），主要依赖 `.am-row` 自身 padding 提供“呼吸感”。
- **默认折叠策略（对齐 VSCode plugin）**：每次展开 `Finished working`（即非 `inProgress` 的 turn）时，内部所有可折叠 block 都强制回到折叠状态，避免长输出“炸屏”。实现见 `CodexChat.tsx` 的 `toggleTurnWorking`。

---

## 3. 样式映射（Codex 插件 → AgentMesh）

### 3.1 交互/结构映射

参考：`docs/implementation-notes/codex-vscode-plugin/conversation-folding-ui.md`

- Codex 插件 `LocalConversationTurnContent` 的“Working/Thinking”折叠区
  - AgentMesh 对应：`CodexChat.tsx` 中 `workingEntries` + `collapsedWorkingByTurnId` 的折叠区
- Codex 插件三层折叠：
  - Turn 折叠（Working/Thinking）
  - Exploration Accordion（探索手风琴）
  - Item 内部展开（单条 exec/read/reasoning/mcp 的详情）
  - AgentMesh 本期只做：Turn 折叠 + Item 内部展开（ActivityBlock/Reasoning 卡片）

### 3.2 视觉 token 映射（建议表）

说明：VSCode/Codex 插件原生使用一套 token（如 `token-input-background`、`token-border`），本项目用 `--am-` 变量承载类似语义。

| 语义 | AgentMesh CSS var | Tailwind 使用示例 | 说明 |
|---|---|---|---|
| App 背景 | `--am-bg-app` | `bg-bg-app` | 页面底色 |
| Panel 背景 | `--am-bg-panel` | `bg-bg-panel/70` | 大面板/容器 |
| Input/Card 背景 | `--am-token-input-background` | `bg-token-inputBackground/70` | 类似 `token-input-background` |
| 通用边框 | `--am-token-border` | `border-token-border/80` | 类似 `token-border` |
| 菜单背景 | `--am-bg-menu` | `bg-bg-menu/95` | popover/menu |
| 菜单 hover | `--am-alpha-menu-item-hover` | `bg-bg-menuItemHover` | 半透明白 hover |
| 卡片阴影 | `--am-shadow-card` | `shadow-card` 或 `.am-card` 内置 | 过程性卡片“浮起” |
| accordion 动画 | —— | `Collapse` + `ACCORDION_TRANSITION` | 对齐插件手感 |

> 后续扩展建议：继续补齐 “token-foreground / token-secondary-foreground / token-panel-background / token-scrollbar” 等语义变量，减少页面级硬编码。

---

## 4. 组件骨架（建议拆分方向）

本期为了快交付，核心逻辑仍在 `CodexChat.tsx`，但建议后续逐步拆到小组件，避免单文件继续膨胀。

### 4.1 页面结构（建议）

- `CodexChat`
  - `TitleBar`（项目选择、窗口按钮、右上角菜单）
  - `ConversationViewport`
    - `Turn`
      - `UserBubble`
      - `WorkingHeader`（点击折叠）
      - `WorkingBody`（Collapse）
        - `ActivityCard`（exec/read/mcp/fileChange/webSearch）
        - `ReasoningCard`
        - `SystemNoticeCard`
      - `AssistantMessage`
  - `Composer`（输入框、+、/、Auto context、Send）

### 4.2 本期已落地组件/样式

- `Collapse`：`apps/gui/src/components/ui/Collapse.tsx`
- `.am-card / .am-card-clickable / .am-divider / .am-label / .am-icon-button / .am-scroll-fade`：`apps/gui/src/index.css`

---

## 5. TODO List（按优先级）

### 5.1 本期（CodexChat 收尾/优化）

- [ ] WorkingHeader 显示更丰富摘要（例如：exec/read/mcp 数量分布、错误状态提示）
- [ ] Reasoning 卡片标题增强：从 Markdown heading/strong 提取标题（参考插件 `useExtractHeading`）
- [ ] 卡片动作区补齐（复制/展开/更多 actions），并统一 `group-hover` 显隐策略
- [ ] 统一 `ActivityBlock` 的“摘要行/展开区”布局到更像 `TimelineItem` 的 offset 结构

### 5.2 后续任务（跨页面/体系化）

- [ ] 抽出 `Turn`/`WorkingSection`/`ReasoningCard`/`SystemNoticeCard` 到独立文件
- [ ] 引入 Exploration Accordion（参考 `segmentAgentItems` / `ExplorationAccordion`）
- [ ] 将 tokens 语义化拓展到其它页面（TaskList/TaskDetail/NewTaskModal）
- [ ] 统一菜单/Popover、输入框、按钮、badge 的组件化（避免每处复制 class）
- [ ] 增加视觉回归检查策略（截图对比或 Playwright/Chromatic 等）

---

## 6. 协作约定（给后续同事）

- **改样式优先改 token**：先加/调 `--am-*` 变量与 Tailwind 映射，不要在组件里散落 `bg-[#xxxxxx]`。
- **折叠动画统一用 `Collapse`**：不要每处自写 motion 参数，避免手感不一致。
- **卡片统一用 `.am-card` 系列类**：需要无阴影/更轻量时，再新增语义类（例如 `.am-surface`），不要每处 `rounded border bg ...` 重复堆。
