# AgentMesh 落地文档（Implementation）

本目录用于把 [[AgentMesh.md]](../../AgentMesh.md) 与 [[README.md]](../../README.md) 的设计，结合 `docs/references/` 里的资料（Skills 定义；A2A/ACP/Subagents 仅作概念参考），整理为**可实施**的工程化方案。

## 推荐阅读顺序（从方案到落地）

1) [`docs/agentmesh/multiagent.md`](./multiagent.md)：multi/subagent 闭环（Orchestrator + Controller + Adapter + Task Directory + Evidence）
2) [`docs/agentmesh/artifacts.md`](./artifacts.md)：任务目录与产物规范（Artifacts-first / human-in-the-loop）
3) [`docs/agentmesh/subagents.md`](./subagents.md)：subagent（workers）如何用 `codex exec --json` 落地并发执行
4) [`docs/agentmesh/adapters/codex.md`](./adapters/codex.md)：Codex adapter（exec / app-server）接入要点与落盘映射
5) [`docs/agentmesh/gui.md`](./gui.md)：GUI（Artifacts-first + Codex Chat）信息架构与交互
6) [`docs/agentmesh/implementation.md`](./implementation.md)：实现评估 + 目标架构（Controller/Adapter/Artifacts 的分层）
7) [`docs/agentmesh/roadmap.md`](./roadmap.md)：多阶段实施路线图（按 OpenSpec changes 推进）
8) [`docs/agentmesh/release.md`](./release.md)：CI / 发版流程

## 目录结构

- [`adapters/`](./adapters/README.md)：运行时适配说明（以 Codex 为首个接入目标）
- [`prompts/`](./prompts/README.md)：可复用 prompt 模板（例如 `codex-worker.md`）
- [`legacy/`](./legacy/README.md)：历史文档归档（避免与当前事实混淆）

## 核心原则（先定产物，再写引擎）

AgentMesh 先把协作过程“落盘”为可追踪、可编辑、可复现的产物（Task Directory + 结构化报告 + 决策记录），再逐步把这些产物接到成熟 CLI 工具的“底层可编程接口”（先做 Codex）。

如果未来需要对接外部生态或编辑器插件，再把 A2A / ACP 作为“兼容层/可选增强”引入。

这会带来一个关键好处：**用户可以在任何环节介入**——改任务拆解、改契约、改约束、驳回/重做某个 agent 的结果——而不需要把一切都“塞回对话框”里。
