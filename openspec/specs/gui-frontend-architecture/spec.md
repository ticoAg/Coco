# gui-frontend-architecture Specification

## Purpose
定义 GUI 前端源码组织结构与模块边界：采用 Feature-first（`app/ + features/ + shared/`）以降低耦合、提升可维护性，并约束依赖方向与 Facade import 规则；迁移过程中保持可渐进落地且构建始终可用。
## Requirements
### Requirement: Feature-first source layout
系统 SHALL 在 [`apps/gui/src`](../../../apps/gui/src) 采用 Feature-first 的源码结构，以明确 app 装配、业务域 feature 与跨域复用 shared 的边界：

- `src/app/`：应用入口与全局装配（例如 App shell、providers、startup glue）
- `src/features/`：按业务域划分的功能模块（例如 `codex-chat`、`tasks`）
- `src/shared/`：跨 feature 复用的 UI、hooks、lib、types 与基础设施封装

#### Scenario: Place new code in the correct layer
- **GIVEN** 需要新增一个仅被 `tasks` 功能使用的 React component
- **WHEN** 开发者提交该组件
- **THEN** 该组件放置在 `src/features/tasks/ui/...`
- **AND** 不放置在 `src/shared`（避免过早抽象）或旧的 `src/components`（避免继续堆叠）

### Requirement: Layered dependency direction
系统 SHALL 保持依赖方向清晰并避免反向依赖：

- `shared` MUST NOT import from `features` 或 `app`
- `features/*` MAY import from `shared`
- `app` MAY import from `features` 与 `shared`

#### Scenario: shared does not depend on feature code
- **GIVEN** `src/shared/ui/TextPreview.tsx` 是共享组件
- **WHEN** 该组件需要某个 feature 的业务逻辑
- **THEN** 业务逻辑应上移到对应 feature
- **AND** shared 仅保留与业务无关的通用渲染/交互能力

### Requirement: Feature Facade as the only public import surface
每个 feature SHALL 提供 `src/features/<feature>/index.ts` 作为对外 Facade，并满足：

- 其他模块（`app` 或其它 feature）MUST 仅从该 Facade import
- feature 内部模块（`ui/`、`model/`、`lib/`、`types/`）不作为跨 feature 的稳定入口

#### Scenario: App imports a feature entry via facade
- **GIVEN** GUI 需要在 App 中渲染 Codex Chat 页面
- **WHEN** App 引用 Codex Chat 组件
- **THEN** import 路径为 `@/features/codex-chat`（通过 Facade 导出）

### Requirement: Incremental migration keeps build green
在执行模块搬迁与拆分的过程中，系统 SHALL 以“可渐进迁移”为约束：

- 每个 change 结束时 `npm -C apps/gui run build` MUST 通过
- 系统 MAY 在旧路径保留薄 shim（re-export）以降低迁移风险，但必须在后续 changes 中收敛到 Facade

#### Scenario: Split a large file without breaking build
- **GIVEN** `CodexChat` 从单文件拆分为多个模块
- **WHEN** 开发者完成一次阶段性拆分提交
- **THEN** GUI 可以成功类型检查并构建

### Requirement: Documentation stays consistent with code moves
当代码搬迁导致文件路径变化时，系统 SHALL 同步更新 `docs/**` 中的路径引用或改为引用稳定入口（例如 feature Facade），避免“事实信息不一致”。

#### Scenario: Update docs referencing moved files
- **GIVEN** 文档引用了 [`apps/gui/src/components/CodexChat.tsx`](../../../apps/gui/src/components/CodexChat.tsx)
- **WHEN** 该文件被迁移到 `src/features/codex-chat/...`
- **THEN** 文档引用被同步更新（或替换为新的稳定入口）
