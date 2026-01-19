# Project Context

## Purpose
AgentMesh 是一个“产物优先（artifacts-first）”的本地编排系统：把一次人类与多个 coding agents 的协作过程，落盘为可追踪、可编辑、可复现的任务目录（`.agentmesh/tasks/*`）。

当前路线选择 **Codex-first**：优先通过 `codex exec --json` / `codex app-server` 这类“底层可编程接口”消费结构化事件流，而非解析 TUI/ANSI 屏幕。

## Tech Stack
- Rust workspace（[`crates/agentmesh-core`](../crates/agentmesh-core), [`crates/agentmesh-orchestrator`](../crates/agentmesh-orchestrator), [`crates/agentmesh-codex`](../crates/agentmesh-codex)）
- GUI：Tauri（Rust）+ React/TypeScript（[`apps/gui`](../apps/gui)）
- 任务与产物：`task.yaml`（YAML），`events.jsonl`（JSON Lines），以及 `shared/*` / `agents/*` 目录结构

## Project Conventions

### Code Style
- 倾向小而清晰的实现；避免过度抽象。
- 尽量复用现有模式（例如 `agentmesh-core` 的 `TaskStore` 负责落盘读写）。
- 不删除现有定义；以新增/扩展为主（除非明确确认删除）。

### Architecture Patterns
- **控制面 / 适配层 / 产物面**分离：
  - 控制面（Orchestrator/CLI）：拓扑、并发、状态机、gates、人类介入。
  - 适配层（Adapter）：对接外部 CLI（先 Codex），并把事件流落盘。
  - 产物面（Task Directory）：事实来源（任务、事件、报告、契约、决策）。
- GUI 尽量保持 **只读任务目录**（MVP 不负责执行/审批）。

### Testing Strategy
- Rust：优先 `cargo test`（按 crate 维度逐步补齐）。
- GUI：优先 `npm -C apps/gui run build` 做类型检查与构建校验。

### Git Workflow
- 以小步可回滚的变更为主；优先保持变更范围与 change-id 对齐。
- 避免在 worker 内执行 `git merge/rebase/push`（参见 [`docs/agentmesh/prompts/codex-worker.md`](../docs/agentmesh/prompts/codex-worker.md)）。

## Domain Context
- `.agentmesh/tasks/<task_id>/` 是单个任务的落盘空间。
- `agents/<agent_instance>/` 下保存该 agent 的 runtime 事件与产物；`shared/` 存放跨 agent 的共享上下文与汇总产物。
- `gates` 用于表达 `input-required`（人类介入点/审批点）。

## Important Constraints
- 不绑定 vendor：Codex 是首个 adapter，但模型与目录结构应尽量协议无关。
- 优先读取结构化事件（JSON/JSONL/RPC），避免解析终端渲染。
- 建议为每个 worker 提供独立 `CODEX_HOME`，保证上下文/会话隔离。

## External Dependencies
- 外部运行时：`codex` 可执行文件需要在用户机器 PATH 中可用（AgentMesh 不负责打包/分发）。
