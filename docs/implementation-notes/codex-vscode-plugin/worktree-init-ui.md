# Worktree 初始化与进度提示 UI

> 来源：`docs/implementation-notes/codex-vscode-plugin/plugin-index.js`。

本文记录本地 worktree 初始化流程的 UI 机制：进度卡片、脚本执行展示、失败处理与“生成初始化脚本”的引导。

## 入口位置

在本地会话线程中，`LocalConversationThreadContent` 会在 header 与 turns 之间插入 `WorktreeInitSteps`：

- 当 `useWorktreeForConversation` 返回记录时渲染。
- `isInitiallyExpanded` 默认在状态非 `ready` 时展开。

溯源：`LocalConversationThreadContent`（`plugin-index.js:278911`），`WorktreeInitSteps` 调用（`plugin-index.js:279012`）。

## WorktreeInitSteps（核心）

`WorktreeInitSteps` 负责将 worktree 状态转换成可渲染的步骤列表：

- `buildItems(record)` 构造步骤数据：
  - 第一步：`git worktree add`（创建 worktree）
  - 第二步：`.codex/worktree_init.sh`（初始化脚本）
- 展开/收起：点击标题行，Chevron 使用 `ACCORDION_TRANSITION` 旋转。
- 状态提示：
  - `pending`：Creating a new worktree
  - 已完成：Created a worktree
  - 初始化中：Setting up a new worktree
  - 脚本失败：显示失败脚本数量

溯源：`WorktreeInitSteps`（`plugin-index.js:237175`），`buildItems`（`plugin-index.js:237362`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

## 步骤卡片（WorktreeExecItemContent）

每个步骤用 `WorktreeExecItemContent` 渲染：

- 摘要行展示命令名称（`parsedCmd`）与状态样式。
- `scriptSteps` 存在时提供二级列表（显示脚本 path + status）。
- 通过 `onClick` 支持打开终端（由外部传入）。
- 进行中时使用 `loading-shimmer` / `loading-shimmer-pure-text`。

溯源：`WorktreeExecItemContent`（`plugin-index.js:236983`）。

## 失败与修复路径

### 删除失败的 worktree

`WorktreeInitActions` 仅在 `initialization-failed` / `clone-failed` 时出现：

- 触发 `messageBus.dispatchMessage("electron-worktree-delete", { path })`。

溯源：`WorktreeInitActions`（`plugin-index.js:237133`）。

### 生成初始化脚本引导

`AboutWorktreesDialog` 用于引导创建初始化脚本：

- CTA：`Generate` 按钮触发 `useCreateInitScriptTask`。
- 生成动作：
  - 通过 `useStartLocalThread()` 启动本地对话任务。
  - Prompt 指引创建 `.codex/environments/dev.toml` 并包含 setup 脚本。

溯源：`AboutWorktreesDialog`（`plugin-index.js:236760`），`useCreateInitScriptTask`（`plugin-index.js:236894`），`useStartLocalThread`（`plugin-index.js:236859`）。

## 快速定位建议

在 `plugin-index.js` 中搜索以下函数名：

- `WorktreeInitSteps`
- `WorktreeExecItemContent`
- `buildItems`
- `WorktreeInitActions`
- `AboutWorktreesDialog`
- `useCreateInitScriptTask`
