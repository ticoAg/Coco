# AgentMesh 落地文档（Implementation）

本目录用于把 [[AgentMesh.md]](../../AgentMesh.md) 与 [[README.md]](../../README.md) 的设计，结合 `docs/references/` 里的资料（Skills 定义；A2A/ACP/Subagents 仅作概念参考），整理为**可实施**的工程化方案。

## 你会在这里找到什么

- [[implementation.md]](./implementation.md)：实现评估 + 目标架构（如何直接读取 CLI 工具的结构化输出，并落盘为可介入产物）
- [[subagents.md]](./subagents.md)：子代理（Subagents）如何用 `codex-cli + prompt` 落地：并发执行、上下文隔离、状态感知、可恢复
- [[artifacts.md]](./artifacts.md)：产物（Artifacts）形态规范：任务目录、结构化报告、显式共享、人工介入点
- [[roadmap.md]](./roadmap.md)：多阶段实施路线图（Codex-first：session 驱动 + 事件流提取）
- [[gui.md]](./gui.md)：GUI 形态（Artifacts-first 的任务页面）
- `adapters/`：运行时适配说明（首个：[`docs/agentmesh/adapters/codex.md`](./adapters/codex.md)）
- `prompts/`：可复用 prompt 模板（首个：[`docs/agentmesh/prompts/codex-worker.md`](./prompts/codex-worker.md)）

## 核心原则（先定产物，再写引擎）

AgentMesh 先把协作过程“落盘”为可追踪、可编辑、可复现的产物（Task Directory + 结构化报告 + 决策记录），再逐步把这些产物接到成熟 CLI 工具的“底层可编程接口”（先做 Codex）。

如果未来需要对接外部生态或编辑器插件，再把 A2A / ACP 作为“兼容层/可选增强”引入。

这会带来一个关键好处：**用户可以在任何环节介入**——改任务拆解、改契约、改约束、驳回/重做某个 agent 的结果——而不需要把一切都“塞回对话框”里。
