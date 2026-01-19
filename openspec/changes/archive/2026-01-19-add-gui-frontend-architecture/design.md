# Design: add-gui-frontend-architecture

## Decision: Feature-first layout
选择 Feature-first（`app/ + features/ + shared/`），而非继续以 “components/hooks/types” 这种横切方式堆叠，原因：
- 当前痛点集中在“单文件多职责 + 跨域耦合”，用 feature 边界更容易做到 SRP（单一职责）与可测试/可替换。
- 与后续拆分目标更贴合：`CodexChat` 与 `TaskDetail` 都是清晰的业务域入口。

## Decision: Facade exports to enforce boundaries
每个 feature 必须提供 `src/features/<feature>/index.ts` 作为 Facade：
- **允许**：`@/features/codex-chat`、`@/features/tasks` 这种稳定 import。
- **禁止/避免**：跨 feature deep import（例如 `@/features/codex-chat/ui/TurnBlock`）。

目的：
- 降低重构时的 import 传播；
- 把“内部实现可变”与“对外 API 稳定”分离（Facade pattern）。

## Decision: Shared is for truly cross-feature reuse
`src/shared` 只容纳跨 feature 复用的内容（例如通用 `ui/`、通用 hooks、lib 工具函数、基础类型），否则优先放在 feature 内：
- 避免 shared 变成新的 “大杂烩层”
- 避免把 feature 语义泄露进 shared（违反 LoD / 增加耦合）

## Migration Strategy: Incremental with thin shims
迁移采用“渐进式搬迁”，每个 change 结束时保持 `npm -C apps/gui run build` 通过：
- **优先策略**：把模块搬到新目录后，在旧路径保留薄 shim（`export * from ...` / `export { X } from ...`），短期兼容旧 import。
- **收敛策略**：在完成某个 feature 的搬迁后，再统一把全仓 import 收敛到 Facade，并删除旧 shim。

Trade-off：
- 优点：减少一次性大范围改 import 的风险与冲突。
- 缺点：短期内存在“双路径”与少量重复入口，需要有明确的收敛计划。

## Risk: docs hardcode file paths
现有文档中存在硬编码路径引用（例如 [`docs/implementation-notes/agentmesh-gui-codex-style/README.md`](../../../../docs/implementation-notes/agentmesh-gui-codex-style/README.md) 直接引用 [`apps/gui/src/components/CodexChat.tsx`](../../../../apps/gui/src/components/CodexChat.tsx)）。

应对：
- 迁移涉及的路径必须同步更新文档；
- 或在文档中改引用 Facade（例如 `@/features/codex-chat` 对应的文件路径），减少后续重构成本。

