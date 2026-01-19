# Coco 项目导航（Start Here）

本页面是 Coco 仓库的“地图”：你应该去哪里找答案、应该读哪些文档、规范（OpenSpec）与解释性文档（Docs）分别承担什么职责。

## 你现在可能在找什么？

- **想快速理解执行闭环**（推荐起点）
  - [`./docs/coco/execution.md`](./docs/coco/execution.md)
- **想看任务目录（Task Directory）与可复盘产物（Artifacts）规范**
  - [`docs/coco/artifacts.md`](docs/coco/artifacts.md)
  - 规范真源（可 validate）：[`openspec/specs/task-directory/spec.md`](openspec/specs/task-directory/spec.md)
- **想落地可信执行：Controller 状态机 / gates / evidence**
  - [`docs/coco/implementation.md`](docs/coco/implementation.md)
  - [`openspec/changes/archive/2026-01-17-add-orchestrator-controller-loop/`](openspec/changes/archive/2026-01-17-add-orchestrator-controller-loop)
  - [`openspec/changes/archive/2026-01-17-add-task-evidence-index/`](openspec/changes/archive/2026-01-17-add-task-evidence-index)
- **想接入 Codex（exec worker / app-server）**
  - [`docs/coco/adapters/codex.md`](docs/coco/adapters/codex.md)
  - [`docs/implementation-notes/codex-cli/app-server-api.md`](docs/implementation-notes/codex-cli/app-server-api.md)
  - [`openspec/changes/archive/2026-01-17-add-codex-app-server-adapter/`](openspec/changes/archive/2026-01-17-add-codex-app-server-adapter)
- **想做 GUI（Artifacts-first + Codex Chat）**
  - [`docs/coco/gui.md`](docs/coco/gui.md)
  - [`docs/implementation-notes/coco-gui-codex-style/README.md`](docs/implementation-notes/coco-gui-codex-style/README.md)
- **想看上下文治理（Workbench / 回望 / Semantic GC）**
  - [`docs/implementation-notes/coco/workbench-state-flow.md`](docs/implementation-notes/coco/workbench-state-flow.md)
- **想知道分阶段实施路线图**
  - [`docs/coco/roadmap.md`](docs/coco/roadmap.md)
- **想浏览整个文档树（总索引）**
  - [`docs/README.md`](docs/README.md)

## 文档分层（保持井然有序的约定）

- **OpenSpec（规范真源）**：[`openspec/`](openspec)
  - 放“可验证的契约”（requirements/scenarios），作为实现与验收的共同基线。
- **Docs（解释与落地说明）**：[`docs/coco/`](docs/coco)
  - 放“如何做/为什么这么做”的工程化文档（可引用 OpenSpec，但不替代规范真源）。
- **Implementation Notes（机制笔记）**：[`docs/implementation-notes/`](docs/implementation-notes)
  - 放“对齐外部系统/源码机制”的笔记（例如 Codex app-server、VSCode 插件交互等）。

## 推荐阅读路径

### 路径 A：方案闭环（从“是什么”到“怎么落地”）

1) [`docs/coco/execution.md`](docs/coco/execution.md)
2) [`docs/coco/artifacts.md`](docs/coco/artifacts.md)
3) [`docs/coco/subagents.md`](docs/coco/subagents.md)
4) [`docs/coco/adapters/codex.md`](docs/coco/adapters/codex.md)
5) [`docs/coco/gui.md`](docs/coco/gui.md)
6) [`docs/coco/roadmap.md`](docs/coco/roadmap.md)

### 路径 B：工程实现（从“契约”到“代码/测试”）

1) [`openspec/specs/`](openspec/specs)（先看关键 capability：task-directory / subagent-* / codex-* / gui-*）
2) [`openspec/changes/`](openspec/changes)（按 change 推进实现）
3) [`docs/implementation-notes/`](docs/implementation-notes)（补齐实现细节与对齐项）

## 归档（历史愿景文档）

早期的 feature proposal/愿景描述已归档到：

- [`docs/coco/legacy/coco-vision-proposal.md`](docs/coco/legacy/coco-vision-proposal.md)
