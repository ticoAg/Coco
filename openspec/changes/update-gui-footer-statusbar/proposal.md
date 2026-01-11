# Change: update-gui-footer-statusbar

## Why
当前 Codex Chat 的输入区上方工具条与参数提示占据主视野，且缺少“IDE 风格”的底部状态栏与上下文用量反馈。将该工具条下移为 Footer Status Bar，并补齐 token/context 用量展示，可提升信息层级与交互一致性，更贴近 VS Code / Cursor 的使用习惯。

## What Changes
- 将输入框上方的工具条整体移动到底部，形成固定的 **Footer Status Bar**（包含 `+`、`Auto context`、`对话设置` 等入口）。
- 在 Footer 右下角展示 **上下文用量**，格式为：`上下文 {percent}% · {used}/{window}`（若窗口未知则退化为 `{used}`）。
- 保留用户气泡（user bubble），将 assistant 输出统一为更偏日志流的 **log block**（减少“聊天气泡感”，提升 IDE 输出可读性）。
- 引入 `lucide-react` 作为图标库，替换目前的字符图标（例如 `☰/⛭/▾`）。

## Scope / Non-goals
- 不复刻 VS Code 扩展打包后的大体积 webview bundle（仅按交互/布局与可观测的视觉语言实现）。
- 不新增/变更 codex app-server 协议；上下文用量基于现有 `thread/tokenUsage/updated` 通知。

## Impact
- Affected specs: `gui-codex-chat`
- Affected code:
  - `apps/gui/src/components/CodexChat.tsx`（布局与渲染逻辑调整、token usage 状态）
  - `apps/gui/package.json`（新增 `lucide-react` 依赖）
  - （可选）新增组件文件：`apps/gui/src/components/codex/*`
- Docs: 默认不需要更新 `docs/`；如后续需要解释状态栏字段含义，可补充文档页并更新 `docs/README.md` 索引。

