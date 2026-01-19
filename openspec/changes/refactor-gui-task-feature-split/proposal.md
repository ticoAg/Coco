# Change: refactor-gui-task-feature-split

## Summary
按 `add-gui-frontend-architecture` 的 Feature-first 结构，把 Task 相关 GUI 源码收敛到 `src/features/tasks/`，并重点对以下热点进行职责拆分与复用抽象：
- `apps/gui/src/components/TaskDetail.tsx`（约 1k+ 行）
- `apps/gui/src/components/TaskList.tsx` / `NewTaskModal.tsx`
- `apps/gui/src/hooks/useTasks.ts` / `useTaskFiles.ts`

目标是**保持行为不变**（Task list / Task detail / tabs / artifacts / sessions 展示不变），同时降低文件体积、减少重复渲染逻辑，并为后续跨 feature 复用（例如 markdown/html/text 预览组件）打好基础。

## Why
现状主要问题：
- TaskDetail 集合了 tab 逻辑、API 调用、预览渲染（Markdown/HTML/Plain）、workbench tree 组装等多职责；
- hooks 与 types 分散在 `src/hooks` / `src/types` 与 `src/components` 之间，形成横切耦合；
- 与 Codex Chat 存在可复用点（例如预览、时间格式化、通用 UI），但缺少明确 shared 层承载。

## What Changes
- 引入 [`apps/gui/src/features/tasks/`](../../../apps/gui/src/features/tasks) 作为 Task GUI 的业务域入口，并提供 Facade：[`apps/gui/src/features/tasks/index.ts`](../../../apps/gui/src/features/tasks/index.ts)。
- 将 `TaskList / TaskDetail / NewTaskModal` 与相关 hooks/types 迁移到 feature 内，目录建议：
  - `ui/`：列表、详情页、tab 子视图、卡片组件
  - `model/`：数据获取 hooks、domain 组装（workbench nodes）
  - `lib/`：纯函数（格式化、类型守卫、预览策略选择）
  - `types/`：task 相关类型（必要时从 `src/types/task.ts` 迁移）
- 对 `TaskDetail.tsx` 做 SRP 拆分：按 tabs（overview/workbench/events/artifacts/sessions）拆出子组件；预览渲染抽成可复用组件（优先放 shared）。
- 迁移期允许旧路径保留薄 shim（re-export），最终收敛到 `@/features/tasks` Facade。

## Non-Goals
- 不调整 Task Directory 的后端协议/数据结构。
- 不改变 UI/UX 与交互（仅重构与组织）。
- 不引入新的依赖库。

## Impact
- Affected specs:
  - 行为保持：不修改 `task-directory` / `gui-artifacts` / `gui-subagent-sessions` 等 requirements（如必须变更，另起 change）
  - 结构性约束：依赖 `gui-frontend-architecture`
- Likely affected code (implementation stage):
  - `apps/gui/src/components/TaskDetail.tsx`
  - `apps/gui/src/components/TaskList.tsx`
  - `apps/gui/src/components/NewTaskModal.tsx`
  - `apps/gui/src/hooks/useTasks.ts`、`apps/gui/src/hooks/useTaskFiles.ts`
  - [`apps/gui/src/types/task.ts`](../../../apps/gui/src/types/task.ts)（可能迁移到 feature/shared）

