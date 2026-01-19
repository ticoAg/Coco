# Change: add-orchestrator-controller-loop

## Summary
新增 `orchestrator-controller-loop` capability：定义“模型 Orchestrator 主控 + 程序 Controller 状态机执行”的闭环协议。

该闭环把 **规划/分解/验收**交给模型，把 **并发调度/落盘/证据链/权限隔离/可恢复**交给程序，并与 AgentMesh 的 Task Directory（artifacts-first）模型对齐。

## Why
- 纯对话流 agent 的上下文会快速被过程噪声填满；需要把过程收敛为可验证产物与状态看板（StateBoard）。
- multi/subagent 并行探索与并行修改需要可控的执行与合并机制；否则会出现“上下文互相污染/难以复盘/权限失控”。
- Codex-first 的底层接口（`codex exec --json` / `codex app-server`）已能提供结构化事件流；缺的是把“模型决策”与“程序执行”连接起来的稳定协议。

## What Changes
- 新增 capability：`orchestrator-controller-loop`。
- 定义：
  - Orchestrator 输出的结构化 `actions`（JSON）
  - Controller 的任务状态机（dispatch/monitor/join/gate/resume）
  - 任务空间（task workspace）与证据引用约定（与 task evidence/index 协同）
  - fork/spawn 两种派生策略的选择规则与落盘字段

## Non-Goals
- 不在本 change 中绑定某个具体 GUI；GUI 只需读取任务目录即可。
- 不在本 change 中实现完整“代码合并/工作树(worktree)隔离”策略细节（先把协议与落盘约定定清楚）。

## Impact
- New spec: `orchestrator-controller-loop`
- Related specs (referenced): `task-directory`, `subagent-orchestration`, `subagent-join-gates`, `codex-exec-adapter`, `codex-app-server-adapter`（新增）。
- Affected code (implementation stage): [`crates/agentmesh-orchestrator`](../../../../crates/agentmesh-orchestrator)（controller 状态机）、[`crates/agentmesh-core`](../../../../crates/agentmesh-core)（落盘/事件）、[`crates/agentmesh-codex`](../../../../crates/agentmesh-codex)（adapter）。
