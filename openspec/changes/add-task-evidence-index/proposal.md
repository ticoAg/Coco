# Change: add-task-evidence-index

## Summary
为 Task Directory 增加“证据索引（Evidence Index）”与可引用的 evidence 条目格式，使 multi/subagent 任务在不依赖对话上下文的情况下也能 **可信、可复盘、可审计**。

## Why
- 多 agent 并发会产生大量探索过程与中间输出，若只依赖聊天记录，容易出现“信息散落 + 无法引用 + 无法复盘”。
- 以 Codex 为例：thread/fork/resume 继承的历史在某些场景下可能是 lossy（尤其工具/命令输出不保证完整回放），因此需要把“关键证据”落到任务目录中，作为事实来源。

## What Changes
- 扩展 `task-directory` capability：新增 `shared/evidence/` 目录与 `shared/evidence/index.json` 约定。
- 定义 `EvidenceEntry` 的最小字段集合与 `sources[]` 类型（file anchor / command execution / runtime event range）。
- 定义在 Markdown 报告中引用证据的最小约定（`evidence:<id>`），以便 GUI/脚本稳定解析。

## Non-Goals
- 不要求持久化模型 CoT（思维链）原文；仅沉淀可验证的证据（文件锚点、命令与输出引用、事件流引用）。
- 不在本 change 中实现 GUI 证据渲染、全文检索或自动提取（后续 change 再做）。

## Impact
- Affected specs: `task-directory`
- Affected code (implementation stage): `crates/agentmesh-core` 的 Task scaffolding；`crates/agentmesh-orchestrator` 的 join/report 生成。
- Docs: 可能需要补充 `docs/agentmesh/artifacts.md` 的 evidence 小节（实现阶段同步）。
