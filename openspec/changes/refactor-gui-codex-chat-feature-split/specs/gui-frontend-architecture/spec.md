## ADDED Requirements

### Requirement: Codex Chat feature module boundary
系统 SHALL 将 Codex Chat 的实现代码收敛到 `apps/gui/src/features/codex-chat/`，并通过 Facade（`apps/gui/src/features/codex-chat/index.ts`）对外暴露。

约束：
- `app/` 与其它 features MUST 从 Facade import（例如 `@/features/codex-chat`）
- Codex Chat 的内部模块（`ui/`、`model/`、`lib/`、`types/`）不作为跨 feature 的稳定入口
- 迁移期 MAY 保留旧路径薄 shim（re-export），但最终应收敛到 Facade

#### Scenario: App imports CodexChat via facade after refactor
- **GIVEN** Codex Chat 已按 feature-first 结构完成迁移
- **WHEN** App 渲染 Codex Chat 页面
- **THEN** App 仅从 `@/features/codex-chat` 导入 `CodexChat`
- **AND** 不直接从 `@/features/codex-chat/ui/*` 或历史 `src/components/*` 深层 import

