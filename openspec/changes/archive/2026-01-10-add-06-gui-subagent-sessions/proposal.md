# Change: add-06-gui-subagent-sessions

## Summary
GUI 增加 “Subagents / Sessions” 展示能力：读取任务目录中的 `agents/*/runtime/events.jsonl` 与 `agents/*/artifacts/final.json`，以 artifacts-first 的方式呈现 subagent 状态与输出。

## Why
当前 GUI 已能列出任务与任务级事件，但尚不能展示 per-agent runtime/events 与最终结构化输出；而 [`docs/agentmesh/gui.md`](../../../../docs/agentmesh/gui.md) 明确把 sessions 视为核心信息架构的一部分。

## What Changes
- 在任务详情页展示 subagents 列表：状态、最后更新时间、快速入口（查看 events / final output）。
- 支持查看某个 subagent 的事件流（MVP：显示最近 N 条或 tail）。
- GUI 仍保持只读（不执行 allow/deny），仅把 blocked gate/指引展示出来。

## Impact
- Specs（新增）：`gui-subagent-sessions`
- 受影响代码（实现阶段）：[`apps/gui`](../../../../apps/gui)（React UI）、[`apps/gui/src-tauri`](../../../../apps/gui/src-tauri)（如需新增读取接口/轮询）
