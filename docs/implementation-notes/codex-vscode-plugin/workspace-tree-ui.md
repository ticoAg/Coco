# Workspace 树与侧边栏任务分组 UI 机制

> 来源：`docs/implementation-notes/codex-vscode-plugin/plugin-index.js`（已打包 webview 代码）。

本文记录 VSCode 插件侧边栏（workspace 分组/threads）与文件树相关 UI 的实现方式，便于在 AgentMesh 中复刻交互与状态管理。

## 侧边栏（workspace / threads）总览

主要入口为 `SidebarElectron` + `SidebarThreadsSection`：

- `SidebarElectron` 负责拉取数据、持久化状态、构建导航区域与 threads 列表。
- `SidebarThreadsSection` 负责按 workspace root 分组渲染任务列表。
- `FolderChevron` 提供分组折叠/展开按钮与动效。

溯源：`SidebarElectron`（`plugin-index.js:105640`），`SidebarThreadsSection`（`plugin-index.js:104054`），`FolderChevron`（`plugin-index.js:105222`）。

### 数据来源

- `useFetchFromVSCode("workspace-root-options")`：workspace roots 与 label 映射。
- `useTasks(...)` + `useConversations()`：本地/云端任务数据聚合。
- `useMergedTasks(...)` + `useRepositoryTaskGroups(...)`：合并与分组逻辑。
- `useInboxItems()`：用于显示 “Automations” 入口与未读数。

### 持久化状态

- 折叠状态：`persistedAtom("sidebar-collapsed-groups", {})`
- 侧边栏视图：`persistedAtom("sidebar-view-v2", "threads")`
- workspace 过滤器：`persistedAtom("sidebar-workspace-filters:<repo>")`

溯源：`aCollapsedGroups`（`plugin-index.js:105638`），`aSidebarView`（`plugin-index.js:105639`），`sidebar-workspace-filters`（`plugin-index.js:103997`）。

折叠状态由 `SidebarThreadsSection` 的 `toggleGroup` 更新；视图状态用来在 “threads / recent” 间切换。

### 分组交互细节

**Folder 行：**

- Hover 时显示 “折叠/展开” 图标（`FolderChevron`）。
- 点击文件夹名称会触发 `messageBus.dispatchMessage("electron-set-active-workspace-root", { root })`，并启动新会话。

**折叠按钮：**

- `FolderChevron` 用 `motion.div` 旋转 `SvgPlaySm` 图标。
- 旋转角度：折叠时 0°，展开时 90°。
- 动画使用 `ACCORDION_TRANSITION`。

溯源：`FolderChevron`（`plugin-index.js:105222`），`ACCORDION_TRANSITION`（`plugin-index.js:64525`）。

**Workspace Roots 管理：**

- 重命名：`WorkspaceRootRename` -> `messageBus.dispatchMessage("electron-rename-workspace-root-option", { root, label })`
- 重排顺序：`messageBus.dispatchMessage("electron-update-workspace-root-options", { roots })`

溯源：`WorkspaceRootRename`（`plugin-index.js:103882`）。

## 文件树组件（FileTree）

文件树用于在 diff/文件选择等场景展示层级结构：

- `FileTree`：计算可展开项、管理折叠状态并渲染 `Accordion`。
- `Node$1`：递归渲染 folder/file。
- `FolderRow` / `FileRow`：分别渲染文件夹与文件行。

溯源：`FileTree`（`plugin-index.js:231865`），`Node$1`（`plugin-index.js:231977`），`FolderRow`（`plugin-index.js:232203`），`FileRow`（`plugin-index.js:232106`）。

### 展开/折叠机制

`FileTree` 内部维护 **折叠集合**：

- `getFolderPaths(items)` 收集所有文件夹路径。
- `vt` 保存“已折叠”路径集合。
- Accordion 的 `value` 传入“展开路径列表”（由 `vt` 反推得到）。

当 Accordion value 变化时：

- 通过 `collectSingleChildFolderChain` 自动展开“单子目录链”，避免只展开父目录导致多层点击。

溯源：`getFolderPaths`（`plugin-index.js:232354`），`buildNodeLookup`（`plugin-index.js:232325`），`collectSingleChildFolderChain`（`plugin-index.js:232337`）。

### 视觉与布局

- 统一缩进：`INDENT_PER_LEVEL = 8`
- Folder / File 行均使用 `Accordion` 的 trigger/content 模式。
- Chevron 图标通过 `accordion-chevron` class + 旋转来体现展开状态。

溯源：`INDENT_PER_LEVEL`（`plugin-index.js:231864`），`Accordion`/`Collapsible`（`plugin-index.js:231597/231471`）。

## 关键标识符速查

- 侧边栏组件：`SidebarElectron`, `SidebarThreadsSection`, `FolderChevron`
- 状态持久化：`sidebar-collapsed-groups`, `sidebar-view-v2`
- 文件树：`FileTree`, `Node$1`, `FolderRow`, `FileRow`
- IPC：`electron-set-active-workspace-root`, `electron-update-workspace-root-options`, `electron-rename-workspace-root-option`
