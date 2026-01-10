# Change: add-05-subagent-join-gates

## Summary
实现 subagents 的 join 汇总与 gates（input-required）机制：把多个 worker 的结构化最终输出汇总为共享报告，并在遇到阻塞/审批点时将任务置为 `input-required`，等待人工介入。

## Why
并发执行只是手段；真正可交付的是“可审计的汇总产物 + 明确的人工介入点”。`docs/agentmesh/artifacts.md` 与 `docs/agentmesh/roadmap.md` 都把 join 与 gates 视为 Phase 1 的核心闭环。

## What Changes
- 基于 `agents/*/artifacts/final.json` 生成 `shared/reports/joined-summary.md`（以及可选的 joined json）。
- 当任一 worker 输出 `status=blocked`（或 adapter 发现需要人工输入）时：
  - 写入 gate（任务进入 `input-required`）
  - 将指引链接到 `shared/human-notes.md`（MVP 由人类编辑后再 resume）
- 引入（或明确）`gate.*` 相关事件写入规则。

## Non-Goals
- 不实现 GUI 内直接 allow/deny（Phase 2+ 再做）。
- 不处理跨 worktree 的自动合并（仅汇总与提示）。

## Impact
- Specs（新增）：`subagent-join-gates`
- 受影响代码（实现阶段）：`crates/agentmesh-orchestrator`、`crates/agentmesh-core`（gates 状态/事件）、模板/报告生成器
