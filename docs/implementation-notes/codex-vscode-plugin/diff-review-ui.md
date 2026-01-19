# Diff 评审与折叠机制（Review UI）

> 来源：[`docs/implementation-notes/codex-vscode-plugin/plugin-index.js`](plugin-index.js)。

本文聚焦 diff 评审相关 UI：Review 头部、文件树开关、展开/折叠、以及 diff hunk 的折叠渲染策略。

## Review 顶部控制区

`ReviewHeader` + `ActionButtons` 负责控制 diff 展示方式：

- 视图模式：`aDiffViewMode`（`unified` / `split`）
- 换行开关：`aWrapCodeDiff`
- 文件树开关：`aFileTreeOpen`
- 全部折叠/展开：`ExpandOrCollapseDiffButton`

`FileTreeToggleButton` 会根据 `aFileTreeOpen` 切换 icon 与 tooltip 文案；`ActionButtons` 还提供：

- 复制 debug 信息（若开启）
- unified/split 切换
- word wrap 切换

溯源：`ReviewHeader`（`plugin-index.js:232574`），`ActionButtons`（`plugin-index.js:232725`），`ExpandOrCollapseDiffButton`（`plugin-index.js:232512`），`FileTreeToggleButton`（`plugin-index.js:233113`），`aDiffViewMode`/`aWrapCodeDiff`（`plugin-index.js:115621-115622`），`aFileTreeOpen`（`plugin-index.js:232572`）。

## 全量展开/折叠事件总线

`useExpandAllCodeDiffs` 使用浏览器事件作为“广播总线”：

- 事件名：`wham-toggle-all-diffs`
- `ExpandOrCollapseDiffButton` 通过该事件通知所有 diff 组件。
- `CodeDiff` 在 mount 时注册 listener，响应 `open` 状态变更。
- 支持 `scope`（例如 `"review"`）限定作用范围。

溯源：`EVENT_NAME`（`plugin-index.js:114586`），`useExpandAllCodeDiffs`（`plugin-index.js:114587`）。

## 单个文件 Diff 组件（CodeDiff）

`CodeDiff` 负责渲染单文件的 diff 区块，并管理 open/closed 状态：

- `defaultOpen` 会在非 deleted 文件上默认展开。
- 内部状态 `open` 受 `useExpandAllCodeDiffs` 广播影响。
- 通过 `onToggleWrap` 与 `aWrapCodeDiff` 实现全文换行。
- 文件路径、打开文件等交互通过 `open-file` mutation 触发。

溯源：`CodeDiff`（`plugin-index.js:114625`）。

## Turn 内 Diff 概览

`TurnDiffContent` / `InProgressTurnDiffContent` 将 diff 摘要嵌入到会话 turn 中：

- `parseDiff(...)` 统计文件数、增删行数。
- 点击 “Review” 触发 `messageBus.dispatchMessage("show-diff", { unifiedDiff, conversationId })` 打开 diff 面板。

溯源：`TurnDiffContent`（`plugin-index.js:239646`）。

## Hunk 折叠渲染（DiffHunksRenderer）

`DiffHunksRenderer.renderCollapsedHunks` 负责“上下文折叠 + 展开提示”：

- `expandedHunks` 保存已展开范围。
- 根据 `expandUnchanged` / `expansionLineCount` 决定折叠区长度。
- `hunkSeparators` 决定分隔符类型（`line-info` / `custom` / `metadata` / `simple`）。
- 折叠区域通过 separator 插入到 AST 中，保持 DOM 结构完整。

溯源：`DiffHunksRenderer.renderCollapsedHunks`（`plugin-index.js:96456`）。

## 快速定位建议

在 `plugin-index.js` 中搜索以下函数名：

- `ReviewHeader`
- `ActionButtons`
- `ExpandOrCollapseDiffButton`
- `FileTreeToggleButton`
- `useExpandAllCodeDiffs`
- `CodeDiff`
- `TurnDiffContent`
- `DiffHunksRenderer.renderCollapsedHunks`
