# Change: Add Multi-Panel Tabs + File Edit/Preview in Codex Chat

## Why
当前 GUI 已支持文件只读预览（Markdown/HTML/raw），但缺少“编辑 + 保存回写”的最小闭环；同时一个窗口内只能看到单一会话面板，无法并行打开多个 agent 或多个文件进行对照与操作。

## What Changes
- 在 Codex Chat 主区域引入“Panels = Tabs”：
  - `agent` panel：展示某个 thread 的会话流历史（与现有 chat 渲染一致）。
  - `file` panel：默认打开编辑视图；右上角通过 “eye” 图标开关 preview 侧栏（Markdown/HTML 预览）。
- 新增受限的文件写入能力：
  - 仅允许在 `workspaceBasePath(cwd)` 下、使用相对路径写入（禁止绝对路径、禁止 `..`、禁止越界）。
  - 仅支持写入已存在的普通文件；限制单文件内容大小（1MB）。

## Impact
- Affected specs:
  - `gui-codex-chat`
- Affected code (expected):
  - [`apps/gui/src/components/CodexChat.tsx`](../../../../apps/gui/src/components/CodexChat.tsx)
  - [`apps/gui/src/api/client.ts`](../../../../apps/gui/src/api/client.ts)
  - [`apps/gui/src-tauri/src/lib.rs`](../../../../apps/gui/src-tauri/src/lib.rs)

