# Design: add-orchestrator-controller-loop

## Context
在“可信高效的 agent 执行方案”里，模型应负责策略/规划，而程序负责确定性执行与可复盘。

- 模型擅长：任务分解、生成候选方案、选择下一步
- 程序擅长：并发调度、隔离权限、落盘证据链、可恢复与可观测

## Goals / Non-Goals
- Goals
  - 定义一套可机器校验的 `actions` 协议，让 controller 可以确定性执行。
  - 定义 task workspace 与 evidence 结构，让主控不需要吃下全部日志。
  - 支持 fork（继承上下文）与 spawn（最小上下文）两种策略。
- Non-Goals
  - 不要求保存 CoT 原文。
  - 不要求所有执行都在同一 thread/同一对话内完成。

## Decisions

### D1: Model outputs actions; controller executes
Orchestrator 输出 JSON（可通过 vendor output-schema 或自校验 schema 约束）。Controller 解析后执行：
- 为每个 action 创建/更新 agent instance 与其目录
- spawn 或 fork 对应的 vendor session
- 监听事件流写入 runtime
- 收敛最终产物写入 shared/

### D2: StateBoard as a compact, human-editable anchor
在 task 目录的 `shared/state-board.md` 维护高信噪比状态：
- current goal / constraints
- confirmed facts（带 evidence 引用）
- todo / next actions

它既是“上下文压缩”的出口，也是 human-in-the-loop 的介入点之一。

### D3: Fork when context inheritance matters; spawn otherwise
- Fork：需要继承讨论过的约束/决策时（例如沿用同一架构方向）
- Spawn：子任务上下文依赖低（把 subagent 当长耗时工具）

## Risks / Trade-offs
- fork 继承的历史可能 lossy：需要依赖 task artifacts 与 evidence 兜底。
- actions schema 过宽会导致 controller 难以保证可信执行；需要从最小闭环逐步扩展。

## Open Questions
- 是否需要把 “lookback / semantic GC” 作为显式 action（例如 `compact_stateboard`）？
- controller 是否需要支持 worktree 隔离作为默认策略？（后续 change 决策）
