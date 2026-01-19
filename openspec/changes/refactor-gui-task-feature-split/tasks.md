# Tasks: refactor-gui-task-feature-split

## 1. Spec
- [ ] 1.1 确认本 change 为行为保持重构：不修改 `openspec/specs/*` 的既有 requirements（如需改动，拆分为独立 change）。
- [ ] 1.2 确认已合入（或同 PR 先落地）`add-gui-frontend-architecture` 的目录与边界约定。

## 2. Implementation
- [ ] 2.1 建立 `apps/gui/src/features/tasks/` 目录骨架（`index.ts` / `ui/` / `model/` / `lib/` / `types/`）。
- [ ] 2.2 迁移 Task 相关组件与 hooks：
  - `TaskList.tsx` / `NewTaskModal.tsx` / `TaskDetail.tsx`
  - `useTasks.ts` / `useTaskFiles.ts`（必要时包含 `useSubagentSessions` / `useSharedArtifacts`）
- [ ] 2.3 拆分 `TaskDetail.tsx`：
  - tabs（overview/workbench/events/artifacts/sessions）拆成 `ui/tabs/*`
  - workbench node 组装与 key 计算下沉到 `model/*` 或 `lib/*`
  - Markdown/HTML/Text 预览抽成可复用组件（优先放 `src/shared/ui`，减少与 Codex Chat 重复）
- [ ] 2.4 收敛跨模块 import：
  - App/其他 feature 仅从 `@/features/tasks`（Facade）导入
  - 迁移期必要时保留旧路径薄 shim（re-export），并在本 change 末尾尽量清理

## 3. Validation
- [ ] 3.1 `openspec validate refactor-gui-task-feature-split --strict`
- [ ] 3.2 `npm -C apps/gui run build`
- [ ] 3.3 （可选）`npm -C apps/gui run lint`
- [ ] 3.4 手动冒烟：打开 Tasks → TaskList 加载 → 进入 TaskDetail → 切换各 tabs（Overview/Workbench/Events/Artifacts/Sessions）

