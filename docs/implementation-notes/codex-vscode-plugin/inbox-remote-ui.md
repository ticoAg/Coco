# Inbox 与 Remote 线程 UI

> 来源：[`docs/implementation-notes/codex-vscode-plugin/plugin-index.js`](plugin-index.js)。

本文覆盖两块 UI：Inbox（Automations 列表与右侧线程面板）以及 Remote 任务线程视图（含 diff review 面板）。

## Inbox 页面结构

核心组件：`InboxPage` + `InboxThreadPane`

### 左侧列表

- 数据来源：`useInboxItems()`
- 列表渲染：`InboxRow`，包含 `title / subtitle / timestamp / unread`。
- 支持占位行：当列表为空或加载中显示 placeholder 条目。
- 选中项由路由参数 `:itemId` 决定。

溯源：`InboxPage`（`plugin-index.js:279154`）。

### 右侧面板

`InboxThreadPane` 的行为：

- 未选择 item：显示空态 “Select an inbox item”。
- item 无 threadId：显示空态 “No thread for this item”。
- 有 threadId：渲染 `LocalConversationThread`（本地会话视图）。

溯源：`InboxThreadPane`（`plugin-index.js:279081`），`LocalConversationThread`（`plugin-index.js:278847`）。

### 布局与交互

- 使用 `PanelGroup` 实现左右可拖拽分栏（`autoSaveId: "inbox-panels"`）。
- 右上角提供 “Open thread” 按钮：跳转到本地会话页面。

溯源：`PanelGroup` 的 `autoSaveId: "inbox-panels"`（`plugin-index.js:279522`）。

### Automation 创建

`InboxPage` 通过 `AutomationDialog` 支持创建 automation：

- workspace roots 来自 `useFetchFromVSCode("workspace-root-options")`
- 保存动作：`useMutationFromVSCode("automation-create")`
- 缺少 workspace roots 时禁用创建按钮

溯源：`AutomationDialog`（`plugin-index.js:235348`）。

## Remote 任务线程

核心组件：`RemoteConversationPage` / `RemoteConversationPageElectron`

### 页面结构（Electron）

`RemoteConversationPageElectron` 使用 `ThreadPageLayout`：

- **Left panel**：`RemoteConversationThread`
- **Right panel**：`RemoteConversationReview`（diff review）
- 右侧面板开关：`aReviewOpen` + `useElectronDiffShortcut`

溯源：`RemoteConversationPageElectron`（`plugin-index.js:284484`），`RemoteConversationThread`（`plugin-index.js:283785`），`RemoteConversationReview`（`plugin-index.js:283576`），`aReviewOpen`（`plugin-index.js:232571`）。

### 顶部 Header

`RemoteConversationHeaderElectron` 展示：

- 项目 + 分支信息（`ThreadTitle`）
- diff 统计（`TaskDiffStats`）
- “Apply diff” 与 “Open in web” 按钮

溯源：`RemoteConversationHeaderElectron`（`plugin-index.js:283280`）。

### 线程内容

`RemoteConversationContent` 负责渲染：

- 用户消息 + 图片附件
- Attempt tabs（`AttemptTabs`）支持多次尝试切换
- 助手输出（streaming 时显示动画 + shimmer）
- 若存在 unified diff，嵌入 `TurnDiffContent` 预览

溯源：`RemoteConversationContent`（`plugin-index.js:284170`），`AttemptTabs`（`plugin-index.js:283596`），`TurnDiffContent`（`plugin-index.js:239646`）。

### Diff 数据来源

`useUnifiedDiff(...)` 会在以下来源中选择：

1. 当前选中的 sibling turn
2. 当前 diff turn（`current_diff_task_turn`）

溯源：`useUnifiedDiff`（`plugin-index.js:283521`）。

## 快速定位建议

在 `plugin-index.js` 中搜索以下函数名：

- `InboxPage`
- `InboxThreadPane`
- `AutomationDialog`
- `RemoteConversationPageElectron`
- `RemoteConversationHeaderElectron`
- `RemoteConversationThread`
- `RemoteConversationContent`
- `RemoteConversationReview`
