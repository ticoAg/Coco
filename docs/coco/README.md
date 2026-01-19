# Coco 落地文档（Implementation）

本目录用于沉淀 Coco 的工程化落地方案，当前以 **Codex CLI** 为中心：任务目录（Artifacts-first）、并行 workers（`codex exec --json`）、以及可选的原生对话/审批（`codex app-server`）。

## 推荐阅读顺序（从方案到落地）

1) [`docs/coco/execution.md`](./execution.md)：执行闭环（Task Directory + Workers + Gates）
2) [`docs/coco/artifacts.md`](./artifacts.md)：任务目录与产物规范（Artifacts-first / human-in-the-loop）
3) [`docs/coco/subagents.md`](./subagents.md)：并行 workers：如何用 `codex exec --json` 落地
4) [`docs/coco/adapters/codex.md`](./adapters/codex.md)：Codex adapter（exec / app-server）接入要点与落盘映射
5) [`docs/coco/gui.md`](./gui.md)：GUI（Artifacts-first + 可选 Codex Chat）信息架构与交互
6) [`docs/coco/implementation.md`](./implementation.md)：实现评估 + 目标架构（Controller/Adapter/Artifacts 分层）
7) [`docs/coco/roadmap.md`](./roadmap.md)：多阶段实施路线图
8) [`docs/coco/release.md`](./release.md)：CI / 发版流程

## 目录结构

- [`adapters/`](./adapters/README.md)：运行时适配说明（Codex）
- [`prompts/`](./prompts/README.md)：可复用 prompt 模板（例如 `codex-worker.md`）
- [`legacy/`](./legacy/README.md)：历史文档归档（避免与当前事实混淆）

## 核心原则（先定产物，再写引擎）

Coco 先把协作过程“落盘”为可追踪、可编辑、可复现的产物（Task Directory + 结构化报告 + 决策记录），再逐步把这些产物接到成熟 CLI 工具的“底层可编程接口”（先做 Codex）。

这会带来一个关键好处：**用户可以在任何环节介入**——改任务拆解、改契约、改约束、驳回/重做某个 agent 的结果——而不需要把一切都“塞回对话框”里。
