# Tasks: refactor-gui-codex-chat-feature-split

## 1. Spec
- [x] 1.1 确认本 change 为行为保持重构：不修改 [`openspec/specs/gui-codex-chat/spec.md`](../../specs/gui-codex-chat/spec.md) 的 requirements（如需改动，拆分为独立 change）。
- [x] 1.2 确认已合入（或同 PR 先落地）`add-gui-frontend-architecture` 的目录与边界约定。

## 2. Implementation
- [x] 2.1 建立 [`apps/gui/src/features/codex-chat/`](../../../apps/gui/src/features/codex-chat) 目录骨架（`index.ts` / `ui/` / `model/` / `lib/` / `types/`）。
- [x] 2.2 迁移 `apps/gui/src/components/codex/**` 到 `features/codex-chat/`（优先保持文件名与相对结构，减少一次性改动）。
- [x] 2.3 将 [`apps/gui/src/components/CodexChat.tsx`](../../../apps/gui/src/components/CodexChat.tsx) 拆分为“容器组件 + hooks + 纯函数模块”：
  - [x] localStorage/settings/pinned items → `lib/storage.ts`
  - [x] 事件 ingest / thread 状态聚合 → `model/*`（hooks + reducer/纯函数）
  - [x] workbench panels / header / composer → `ui/*`
- [x] 2.4 将 `apps/gui/src/components/codex/TurnBlock.tsx` 拆分：
  - [x] 纯函数（extract/count/format）→ `lib/turn/*`
  - [x] 复杂分支渲染拆成小组件 → `ui/turn/*`
- [x] 2.5 收敛跨模块 import：
  - App/其他 feature 仅从 `@/features/codex-chat`（Facade）导入
  - 迁移期必要时保留旧路径薄 shim（re-export），并在本 change 末尾尽量清理
- [x] 2.6 同步更新文档硬编码路径引用（至少覆盖 [`docs/implementation-notes/coco-gui-codex-style/README.md`](../../../docs/implementation-notes/coco-gui-codex-style/README.md)）。

## 3. Validation
- [x] 3.1 `openspec validate refactor-gui-codex-chat-feature-split --strict`
- [x] 3.2 `npm -C apps/gui run build`
- [x] 3.3 （可选）`npm -C apps/gui run lint`
- [ ] 3.4 手动冒烟：打开 Codex Chat → 列表加载 → 进入 thread → turn 流式渲染/Working 分组/Approvals 可用
