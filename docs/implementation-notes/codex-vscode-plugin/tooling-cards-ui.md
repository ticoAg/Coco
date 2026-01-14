# 工具与内容卡片 UI（Exec / Reading / Reasoning / MCP 等）

> 来源：`docs/implementation-notes/codex-vscode-plugin/plugin-index.js`。

本文整理“过程性输出卡片”的 UI 机制，覆盖命令执行、读取文件、推理、MCP 工具调用、计划等卡片组件。它们通常出现在 **Working** 折叠区或对话的固定区域中。

## 统一外观骨架

### TimelineItem

`TimelineItem` 用于统一卡片的基础 padding 与层级视觉：

- `padding: "default"`：普通行内卡片（默认 `py-1`）。
- `padding: "offset"`：适用于“卡片式”内嵌布局（带左右偏移与更紧凑边距）。

溯源：`TimelineItem`（`plugin-index.js:236934`）。

### InProgressFixedContentItem

用于展示“固定在进度区域”的卡片（如计划、Diff 概览等）：

- 支持 `action` 右侧动作区 + `expandedContent` 下方展开区。
- `onClick` 存在时整体变为可点击（`cursor-interaction`）。
- 统一背景与边框：`bg-token-input-background/70` + `border-token-border/80`。

溯源：`InProgressFixedContentItem`（`plugin-index.js:238050`）。

## Exec 卡片（命令执行）

组件：`ExecItemContent`

关键点：

- 展开状态：`vt`，默认在“自动类型 + 正在执行”时展开。
- 自动展开逻辑：`shouldAutoToggle` 对 `format/test/lint/noop/unknown` 类型生效。
- 摘要行：由 `CmdSummaryText` 渲染（根据 parsed command 分类生成）。
- 操作区：包含复制按钮（`CopyButton`）与 Chevron 展开提示。
- 展开内容：`Shell` 组件展示命令 + 聚合输出。
- 动画：`AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`。

溯源：`ExecItemContent`（`plugin-index.js:275608`），`CmdSummaryText`（`plugin-index.js:275850`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## AgentMesh 对齐实现（Shell 结构统一）

为对齐 VSCode 插件的 Shell 结构，AgentMesh 的 `ActivityBlock` 详情区统一改为 Shell 风格滚动容器：

- 统一使用 `am-shell` / `am-shell-scroll`（`apps/gui/src/components/CodexChat.tsx` + `apps/gui/src/index.css`）。
- 视觉参数对齐：`max-height: 176px`，`padding: 8px`，`font-mono font-medium`（仅在需要等宽时），`overflow-x/overflow-y: auto`。
- 滚动条与渐隐：`am-shell-scroll` 定义自定义 scrollbar；`am-scroll-fade` 提供上下渐隐（与插件 `vertical-scroll-fade-mask` 行为一致）。
- Exec 卡片仍保留摘要行，同时在详情区增加 Shell header（复制/折叠按钮），与 VSCode 的 “summary + shell header” 双层结构一致。
- Patch（文件变更）不再使用外层标题行，改为每个文件单独 header + diff 内容，审批按钮移动到列表末尾。

## Reading 卡片（读取文件列表）

组件：`ReadingItemContent`

关键点：

- 展开状态：`ht`，可由 `expandSignal` 触发自动展开。
- 摘要文本：`ReadingSummaryText` 根据文件数量/状态生成。
- 展开内容：文件 chips（`FileItem`），可点击打开文件。
- 动画：`AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`。

溯源：`ReadingItemContent`（`plugin-index.js:276583`），`ReadingSummaryText`（`plugin-index.js:276749`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## Reasoning 卡片（推理）

组件：`ReasoningItemContent`

关键点：

- 仅在“推理完成且有 body”时允许展开。
- `useExtractHeading` 解析 Markdown 的 heading/strong 作为标题。
- 展开内容使用 `WithScrolling` + `vertical-scroll-fade-mask` 控制高度。
- 动画：`AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`。

溯源：`ReasoningItemContent`（`plugin-index.js:276904`），`useExtractHeading`（`plugin-index.js:277072`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## MCP 工具卡片

组件：`McpToolItemContent`

关键点：

- 仅在调用完成后允许展开。
- 折叠状态展示 `server.tool(argsPreview)`（`formatArgumentsPreview`）。
- 展开区包含：
  - `ContentBlock`（文本/图片/音频/资源链接/嵌入资源）
  - 结构化 JSON 预览（`CodeSnippet`）
  - “Raw Payload” 弹窗（`Dialog` + `CodeSnippet`）
- 动画：`AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`。

溯源：`McpToolItemContent`（`plugin-index.js:276035`），`ContentBlock`（`plugin-index.js:276344`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## 计划卡片（Plan）

### TaskProgressItemContent（Working 内简版）

- 紧凑清单：显示“完成数/总数”，展开后显示步骤列表。
- 每个步骤用 `SvgCheckCircle / SvgUnselectedCircle` 表示状态。
- 动画：`AnimatePresence` + `motion.div` + `ACCORDION_TRANSITION`。

溯源：`TaskProgressItemContent`（`plugin-index.js:277709`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

### TodoPlanItemContent（固定区完整版）

- 可展开/收起，支持滚动定位到当前 in_progress 步骤。
- 使用 `StatusBadge` + 数字编号前缀。
- 展开内容包裹在 `InProgressFixedContentItem`。

溯源：`TodoPlanItemContent`（`plugin-index.js:239318`），`StatusBadge`（`plugin-index.js:239555`），`InProgressFixedContentItem`（`plugin-index.js:238050`）。

## 错误与系统提示卡片

### StreamErrorContent

- 当 `additionalDetails` 存在时可展开查看详情。
- 展开区使用与其他卡片一致的折叠动画。

溯源：`StreamErrorContent`（`plugin-index.js:277178`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

### SystemErrorContent / SystemErrorItemContent

- 系统错误文本直接展示，必要时包裹 `TimelineItem`。

溯源：`SystemErrorContent`（`plugin-index.js:277300`），`SystemErrorItemContent`（`plugin-index.js:277330`），`TimelineItem`（`plugin-index.js:236934`）。

## 通用交互与视觉模式

- Chevron + 旋转：展示折叠状态（`rotate-180`）。
- `group-hover`：控制按钮/图标的显隐。
- `loading-shimmer` / `loading-shimmer-pure-text`：进行中态提示。

溯源：`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## 快速定位建议

在 `plugin-index.js` 中搜索以下函数名：

- `TimelineItem`
- `InProgressFixedContentItem`
- `ExecItemContent`
- `ReadingItemContent`
- `ReasoningItemContent`
- `McpToolItemContent`
- `TaskProgressItemContent`
- `TodoPlanItemContent`
- `StreamErrorContent`
