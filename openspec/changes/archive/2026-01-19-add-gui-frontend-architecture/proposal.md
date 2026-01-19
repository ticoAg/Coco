# Change: add-gui-frontend-architecture

## Summary
为 [`apps/gui/src`](../../../../apps/gui/src) 引入 **Feature-first** 的源码组织方式（`app/` + `features/` + `shared/`），并新增一个面向“前端源码结构/边界/复用策略”的 OpenSpec capability：`gui-frontend-architecture`，用于把目录规范与模块边界固化下来，作为后续 `CodexChat / TaskDetail / TurnBlock` 拆分重构的共同基线。

## Why
当前 GUI 代码主要问题是“单文件多职责、功能耦合、难复用”，尤其集中在：
- [`apps/gui/src/components/CodexChat.tsx`](../../../../apps/gui/src/components/CodexChat.tsx)（约 5k+ 行，包含会话管理 + 事件 ingest + UI 弹层 + 文件编辑/预览 + workbench 等多职责）
- `apps/gui/src/components/TaskDetail.tsx`（约 1k+ 行）
- `apps/gui/src/components/codex/TurnBlock.tsx`（约 1k+ 行）

这会带来：
- 修改成本高：定位逻辑、改动影响面难评估；
- 复用困难：同类渲染（Markdown/HTML preview、错误提示、面板布局）散落在多个组件里；
- 风险堆叠：每次新增功能都倾向继续往大文件加逻辑。

## What Changes
- 新增（并最终落到 [`openspec/specs`](../../../specs) 的）capability：`gui-frontend-architecture`，定义：
  - `src/app | src/features | src/shared` 的目录职责；
  - feature 对外暴露 Facade（`index.ts`）与内部模块边界；
  - shared 层的复用组件与工具的归档规则；
  - 渐进式迁移策略（每个 change 之后都能 `npm run build`）。
- 作为后续重构的“共同前置 change”，本 change **不要求改变 GUI 行为**，仅建立结构与规则，使后续拆分可分阶段推进。

## Non-Goals
- 不引入新的状态管理库（Redux/Zustand 等）。
- 不改 UI/UX（特别是 `CodexChat` 的 VSCode 插件对齐样式与交互，参考 [`docs/implementation-notes/coco-gui-codex-style/README.md`](../../../../docs/implementation-notes/coco-gui-codex-style/README.md)）。
- 不在本 change 内完成具体业务模块（CodexChat/TaskDetail/TurnBlock）的代码迁移与拆分（这些在后续独立 changes 中完成）。

## Impact
- Affected specs:
  - `gui-frontend-architecture`（新增）
- Likely affected code (implementation stage):
  - `apps/gui/src/**`（新增目录、迁移文件、更新 imports）

