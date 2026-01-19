# Tasks: add-gui-frontend-architecture

## 1. Spec
- [x] 1.1 新增 capability：`gui-frontend-architecture` spec delta（目录结构、依赖方向、facade 暴露、迁移策略）。
- [x] 1.2 在 `design.md` 里记录关键决策与 trade-offs（尤其是渐进式迁移与兼容层策略）。

## 2. Implementation
- [x] 2.1 在 `apps/gui/src` 下新增 `app/`、`features/`、`shared/` 目录，并建立最小化的 `index.ts` / README（如需要）以表达边界。
- [x] 2.2 约定 feature 命名与导出方式：`src/features/<feature>/index.ts` 为唯一跨模块 import 入口（Facade）。
- [x] 2.3 迁移策略：允许在旧路径（如 `src/components/*`）保留 **薄 re-export shim**（仅 `export * from ...`），用于降低搬迁时的 import 爆炸面；并在后续 changes 中逐步收敛/移除。

## 3. Validation
- [x] 3.1 `openspec validate add-gui-frontend-architecture --strict`
- [x] 3.2 `npm -C apps/gui run build`
- [x] 3.3 （可选）`npm -C apps/gui run lint`
