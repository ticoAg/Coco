# Feature Requirements: sidebar-wt-branch

## Status
- Current: vFinal (confirmed)
- Base branch: dev
- Feature branch: feat/sidebar-wt-branch
- Worktree: /Users/ticoag/Documents/myws/ags/AgentMesh-feat-sidebar-wt-branch
- Created (UTC): 2026-01-19T15:14:07Z

## v0 (draft) - 2026-01-19T15:14:07Z

### Goals
- 在 Codex Chat 左侧 SessionTree 中，为每个“会话节点”（`task` / `orchestrator` / `worker`）的标题末尾展示工作分支标识：`wt-[branch]`，避免必须点进会话才能确认其工作目录/分支。
- `wt` 为固定前缀，`[]` 内为 branch name（允许很长）。
- branch name 过长时：按固定宽度截断（ellipsis），hover 显示完整 `wt-[branch]`。

### Non-goals
- 不改动 sessions 的排序/分组/归档/右键菜单等行为。
- 不在 collapsed sidebar 模式做展示（collapsed 视图本身不渲染 tree 列表）。
- 不做跨 workspace 的 thread 聚合展示（仍以当前 workspace 的 sessions 为范围）。

### Acceptance criteria
- SessionTree 中 `task` / `orchestrator` / `worker` 节点均能展示 `wt-[branch]` 标签。
- `wt-[branch]` 中的 branch 来自 thread 的 `cwd` 匹配到 `git worktree list --porcelain` 的结果（WorktreeInfo.branch）。
- branch 很长时标签会被截断；鼠标悬停在标签上可看到完整字符串（`title`）。
- 不影响现有节点的点击/展开/右键/hover 行为与布局稳定性（不应导致节点高度变化）。

### Open questions
- 标签截断“固定长度”的度量：用固定像素宽度（例如 `max-w-[120px]`）是否可接受？还是需要按字符长度（例如最多 24 个字符）截断？
- 当无法解析 branch 时的降级策略：
  - 方案 A：不显示标签
  - 方案 B：显示 `wt-[unknown]`
  - 方案 C：匹配到 worktree 但 detached 时显示 `wt-[detached]`，其他情况显示 `wt-[unknown]`

### Options / trade-offs
- Option A: 直接把 `wt-[branch]` 拼接到节点 `label` 文本中
  - Pros: 改动小
  - Cons: 当 label 本身很长时，branch 更容易被一起截断，不够“明显区分”
- Option B: TreeNode 增加独立的 suffix `<span>` 渲染 `wt-[branch]`（推荐）
  - Pros: 可为标签单独设置固定宽度/截断/hover title，更稳定
  - Cons: 需要扩展 TreeNode 渲染与 TreeNodeData metadata

### Verification plan
- Unit tests:
- Integration tests:
- Manual steps:
  - 打开 GUI → Codex Chat → 展开左侧 SessionTree，确认节点标题末尾出现 `wt-[branch]`。
  - 构造一个超长 branch name（例如 `feat/very-very-long-branch-name-...`），确认标签截断且 hover 可见全名。
  - 选择/切换不同会话，确认不会影响现有交互（点击、右键、展开折叠、归档按钮 hover 等）。
  - `npm -C apps/gui run build`（或项目约定的最小 build 命令）确保类型与构建通过。

## vFinal - 2026-01-19

确认：2026-01-19（用户确认：固定宽度截断 OK；fallback `unknown/detached` OK；仅对 `task/orchestrator/worker` 展示 OK）

### Goals
- 在 Codex Chat 左侧 SessionTree 中，为 `task` / `orchestrator` / `worker` 节点标题末尾展示 `wt-[branch]` suffix，便于快速识别会话所在 worktree/branch。

### Behavioral decisions
- **显示范围**：仅 `task` / `orchestrator` / `worker` 节点展示；`repo` / `file` / `folder` 不展示。
- **截断策略**：suffix 使用固定宽度（`max-w-[120px]` + `truncate`）。
- **tooltip**：hover suffix 显示完整 `wt-[branch]`（使用 `title`）。
- **fallback**：
  - 无法解析 branch → `wt-[unknown]`
  - detached HEAD → `wt-[detached]`

> 在用户确认后补齐，并标注确认日期/版本差异。
