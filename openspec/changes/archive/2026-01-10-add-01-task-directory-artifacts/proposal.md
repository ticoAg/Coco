# Change: add-01-task-directory-artifacts

## Summary
将 [`docs/coco/artifacts.md`](../../../../docs/coco/artifacts.md) 中的 Task Directory / Artifacts / Human-in-the-loop 规范整理为可验证的 OpenSpec 变更提案，作为后续 CLI、Codex adapter、subagents 编排与 GUI 展示的共同契约。

## Why
当前仓库已有 `.coco/tasks/*` 的最小落盘能力（[`crates/coco-core`](../../../../crates/coco-core)），但“目录结构、必需文件、事件与 gates 语义”仍以文档为主，缺少可被实现与测试对齐的规格来源。

## What Changes
- 明确 `.coco/tasks/<task_id>/` 的**目录结构**与“人类入口”文件约定（README / shared/* / agents/*）。
- 明确 `task.yaml`（TaskFile）与 `events.jsonl`（TaskEvent）的最小要求与兼容策略（例如 legacy state alias）。
- 约束“显式共享（context-manifest）/ human-notes / gates”的最小落盘与链接方式（先定义，不强制 GUI/adapter 立即实现所有交互）。
- 在本次 change 的 tasks 中加入：[`docs/README.md`](../../../../docs/README.md) 增加 [`openspec/`](../../..) 索引入口（实现阶段执行）。

## Non-Goals
- 不在本 change 中实现 Codex adapter、subagent 并发、GUI 新页面（分别由后续 changes 覆盖）。
- 不引入 A2A/ACP 网络互通协议（仅做术语与建模参考）。

## Impact
- Specs（新增）：`task-directory`
- 受影响代码（实现阶段）：[`crates/coco-core`](../../../../crates/coco-core)（TaskStore/task schema 落盘补齐）、[`schemas/task.schema.json`](../../../../schemas/task.schema.json)（如需对齐）
- 文档影响（实现阶段）：[`docs/README.md`](../../../../docs/README.md) 增加 [`openspec/`](../../..) 索引（入口一致性）
