# Change: add-gui-codex-chat-core

## Summary
为 GUI 增加 Codex Chat 交互能力：直接由 Tauri Rust 进程驱动 codex 二进制，实现会话列表、流式对话、工具/文件/搜索事件展示，并提供 `model` 与 `model_reasoning_effort` 的快捷选择；其余配置通过 GUI 内编辑 `~/.codex/config.toml` 完成。

## Why
当前 GUI 仍以任务与产物浏览为主，缺少与主进程直接对话的能力。目标是让 GUI 具备与 `codex-cli` 同级的核心交互体验（含历史、流式输出、工具调用、文件修改、审批策略、web_search 展示），并为后续更完整能力分期演进奠定基础。

## What Changes
- 新增 Codex Chat 视图（会话列表 + 消息流 + 输入区）。
- Tauri Rust 侧实现 Codex 进程/协议适配（不依赖 Node SDK）。
- 会话列表读取 `~/.codex/sessions` 并按最近更新时间排序，显示会话 id 与摘要。
- 底部输入区提供 `model` 与 `model_reasoning_effort` 下拉覆盖；其它配置通过内置编辑面板直接修改 `~/.codex/config.toml`。
- 在消息流中展示工具调用、文件变更、web_search 等事件；审批请求以内联消息形式展示「批准/拒绝」。

## Impact
- Specs（新增）：`gui-codex-chat`
- 受影响代码（实现阶段）：`apps/gui`、`apps/gui/src-tauri`
- 文档：可能新增 GUI 使用说明与配置说明（按实施情况确认）

## Open Questions / Decisions
- **审批请求的交互通道**：`codex exec --experimental-json` 不暴露审批请求事件，若需内联批准/拒绝，需切换为 `codex app-server`（JSON-RPC over stdio）或等待上游支持。
  - **建议**：为满足审批交互与完整功能集，优先使用 `codex app-server` 协议实现（仍由 Rust 直接驱动，并使用系统 PATH 的 codex）。
