## ADDED Requirements

### Requirement: Tasks feature module boundary
系统 SHALL 将 Task GUI 的实现代码收敛到 [`apps/gui/src/features/tasks/`](../../../../../apps/gui/src/features/tasks)，并通过 Facade（[`apps/gui/src/features/tasks/index.ts`](../../../../../apps/gui/src/features/tasks/index.ts)）对外暴露。

约束：
- `app/` 与其它 features MUST 从 Facade import（例如 `@/features/tasks`）
- Tasks feature 的内部模块（`ui/`、`model/`、`lib/`、`types/`）不作为跨 feature 的稳定入口
- 迁移期 MAY 保留旧路径薄 shim（re-export），但最终应收敛到 Facade

#### Scenario: App imports TaskDetail via facade after refactor
- **GIVEN** Tasks feature 已完成迁移
- **WHEN** App 需要渲染 TaskDetail
- **THEN** App 从 `@/features/tasks` 导入 `TaskDetail`
- **AND** 不直接从 `@/features/tasks/ui/*` 或历史 `src/components/*` 深层 import

