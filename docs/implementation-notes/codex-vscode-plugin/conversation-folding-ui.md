# AI 会话多层级折叠/显示机制（VSCode 插件 Webview）

本文基于 [`docs/implementation-notes/codex-vscode-plugin/plugin-index.js`](plugin-index.js) 里的已打包实现，记录本地会话页面（截图所示）在 UI 上如何进行多层级折叠/展开与显示。重点是“一个会话 turn 内的层级折叠结构 + 互动状态 + 动画”。

> 说明：该文件是打包产物，函数名仍保留但代码被编译为运行时结构；定位建议用函数名检索。

## 总体结构（从页面到 turn）

- 页面入口：`LocalConversationThread` / `LocalConversationThreadContent`
- 单个 turn：`LocalConversationTurn` -> `LocalConversationTurnContent`
- 核心分组：`splitItemsIntoRenderGroups` + `segmentAgentItems`

`LocalConversationTurnContent` 先把 `turn.items` 拆分为：

- `userItem`（用户输入）
- `agentItems`（工具/推理/读取/命令等）
- `assistantItem`（最终回复）
- `systemEventItem` / `turn-diff` / `plan` / `approval` / `remote-task` / `agent-mode-change`

然后在同一个 turn 中，以 **“折叠头（Working/Thinking） + 可折叠内容区域 + 其他固定区域”** 的方式渲染。

溯源：`LocalConversationThread`/`LocalConversationThreadContent`（`plugin-index.js:278847/278911`），`LocalConversationTurn`/`LocalConversationTurnContent`（`plugin-index.js:278011/278036`），`splitItemsIntoRenderGroups`（`plugin-index.js:277875`），`segmentAgentItems`（`plugin-index.js:278685`）。

## 最高层折叠：Turn 内“Working/Thinking”区域

- 组件：`LocalConversationTurnContent`
- 状态：`Rt`（是否展开），默认在 `in_progress` 时为 true。
- 触发：点击标题行（`TurnStatusLabel` + Chevron）。
- 条件：只有当 `agentItems` 存在时才出现展开入口。
- 动画：`AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`（高度 + 透明度）。

**作用**：把工具/推理/读取/计划等“过程性输出”折叠成一个二级区域，避免与最终回复混杂。

溯源：`LocalConversationTurnContent`（`plugin-index.js:278036`），`TurnStatusLabel`（`plugin-index.js:277925`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## 二级折叠：探索（Exploration）手风琴

- 组件：`ExplorationAccordion`
- 分组来源：`segmentAgentItems`
  - `isExplorationStarter`：`reading-files` 或 `exec` 且命令类型为 `list_files/search/read`
  - `isExplorationContinuation`：探索类命令或 `reasoning`
- 状态：
  - `mt`：是否“正在探索”（`status === 'exploring'`）
  - `gt`：用户是否展开
- 自动行为：探索中会自动展开；结束后可保持折叠。
- 列表容器：有 `max-h-26` 的滚动区域 + 顶部遮罩渐变 + 自动滚动至底部。

**UI 细节**：

- 标题文本会根据状态切换（Exploring/Explored），并可显示文件计数。
- Chevron 旋转 + `group-hover` 透明度控制。

## 三级折叠：单条 Item 内部展开

溯源：`ExplorationAccordion`（`plugin-index.js:278335`），`segmentAgentItems`（`plugin-index.js:278685`），`isExplorationStarter`（`plugin-index.js:278725`），`isExplorationContinuation`（`plugin-index.js:278734`），`getUniqueReadingCount`（`plugin-index.js:278737`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

这一层是每条“过程性 item”的详情展开，常见于命令输出、读取文件列表、推理正文、错误详情、计划详情等。

### 1) 命令执行：`ExecItemContent`

- 状态：`vt`（是否展开），默认在“自动类型 + 正在执行”时展开
- 自动逻辑：`shouldAutoToggle` 对 `format/test/lint/noop/unknown` 等类型自动展开
- 展开内容：`Shell` 组件展示命令输出
- 触发：点击摘要行；`expandSignal` 也可以触发自动展开
- 动画：`AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`

溯源：`ExecItemContent`（`plugin-index.js:275608`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

### 2) 读取文件列表：`ReadingItemContent`

- 状态：`ht`（是否展开）
- 展开内容：文件 chips（可点击打开文件）
- 动画：`AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`

溯源：`ReadingItemContent`（`plugin-index.js:276583`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

### 3) 推理内容：`ReasoningItemContent`

- 只有当推理完成且有正文（`body`）时可展开
- 展开区域内带滚动容器（`vertical-scroll-fade-mask`）
- 内容是 Markdown 渲染

溯源：`ReasoningItemContent`（`plugin-index.js:276904`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

### 4) 错误详情：`StreamErrorContent`

- 当 `additionalDetails` 存在时可展开
- 展开区域使用同样的高度/透明度动画

溯源：`StreamErrorContent`（`plugin-index.js:277178`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

### 5) 计划详情：`TaskProgressItemContent`（Working 内简版） / `TodoPlanItemContent`（固定区）

- Working 内展示紧凑计划清单（带完成状态）
- 固定区展示完整计划清单，并支持展开/收起

溯源：`TaskProgressItemContent`（`plugin-index.js:277709`），`TodoPlanItemContent`（`plugin-index.js:239318`）。

### 6) MCP 工具调用：`McpToolItemContent`

- 仅在调用完成后允许展开
- 展开后包含结构化内容 / 纯文本 / 原始 JSON
- 同样使用 `AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`

溯源：`McpToolItemContent`（`plugin-index.js:276035`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## 折叠动画与视觉提示

- 统一动画参数：`ACCORDION_TRANSITION`（`duration: 0.3`, `ease: [0.19, 1, 0.22, 1]`）
- 常见视觉提示：
  - Chevron 旋转（`rotate-180`）
  - `group-hover` 触发的透明度渐显
  - `loading-shimmer` / `loading-shimmer-pure-text` 表示进行中

溯源：`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## 布局容器与层级视觉

- `TimelineItem` 统一提供 padding / offset 与层级排版
- `padding: 'offset'` 常用于“内嵌卡片”或“工作区块”
- Working 区域内部 item 用 `TimelineItem` 包裹，保证视觉一致性

溯源：`TimelineItem`（`plugin-index.js:236934`）。

## 关键交互模式总结

- 折叠入口 = 可点击区域 + Chevron 提示
- 展开详情 = `AnimatePresence` + `motion.div` 高度/透明度动画
- 自动展开 = in-progress 状态或特定命令类型触发
- 嵌套展开 = “Turn 折叠” -> “Exploration 折叠” -> “Item 详情折叠”

## 顺带观察到的其他折叠/分组实现

虽非会话主体，但同属同一 UI 体系（可复用交互模式）：

- 工作区文件树：`Accordion` / `Collapsible` 组件体系（`FolderRow` / `Node$1`）
- Diff 区域：`ExpandOrCollapseDiffButton` + `renderCollapsedHunks` 等
- 其他“面板折叠”通用数据属性：`data-panel-collapsible`

溯源：`Collapsible`/`Accordion`（`plugin-index.js:231471/231597`），`FolderRow`（`plugin-index.js:232203`），`Node$1`（`plugin-index.js:231977`），`ExpandOrCollapseDiffButton`（`plugin-index.js:232512`），`renderCollapsedHunks`（`plugin-index.js:96456`），`data-panel-collapsible`（`plugin-index.js:226716`）。

## 快速定位建议

在 `plugin-index.js` 中搜索以下函数名：

- `LocalConversationTurnContent`
- `ExplorationAccordion`
- `ExecItemContent`
- `ReadingItemContent`
- `ReasoningItemContent`
- `StreamErrorContent`
- `TaskProgressItemContent`
- `TodoPlanItemContent`
- `McpToolItemContent`
- `ACCORDION_TRANSITION`
