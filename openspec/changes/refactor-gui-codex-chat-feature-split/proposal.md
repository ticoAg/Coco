# Change: refactor-gui-codex-chat-feature-split

## Summary
按 `add-gui-frontend-architecture` 定义的 Feature-first 结构，将 Codex Chat 相关源码从“横切目录 + 大文件”重组为 `src/features/codex-chat/`，并对两处主要热点做职责拆分：
- [`apps/gui/src/components/CodexChat.tsx`](../../../apps/gui/src/components/CodexChat.tsx)（约 5k+ 行）
- `apps/gui/src/components/codex/TurnBlock.tsx`（约 1k 行）

目标是**不改变 GUI 行为**（保持 `gui-codex-chat` spec 不变）的前提下，降低耦合、提升可读性与可复用性，为后续 panel / workbench 扩展留出清晰边界。

## Why
现状主要问题：
- `CodexChat.tsx` 同时承担：线程/turn 状态机、事件 ingest、localStorage 持久化、UI 布局、面板（edit/preview）、输入区、菜单等多职责；
- `TurnBlock.tsx` 混合了：turn 分组策略、渲染逻辑、渲染 helper、子卡片组件、统计/提取函数等；
- 多处逻辑散落在“组件文件内部函数”，难复用、难测试、改动风险高。

## What Changes
- 引入 [`apps/gui/src/features/codex-chat/`](../../../apps/gui/src/features/codex-chat) 作为 Codex Chat 的唯一业务域入口，并提供 Facade：[`apps/gui/src/features/codex-chat/index.ts`](../../../apps/gui/src/features/codex-chat/index.ts)。
- 将现有 `apps/gui/src/components/codex/**` 迁移/归并到 `features/codex-chat/` 下（优先“搬家不改名”，再逐步拆分）。
- 对 `CodexChat.tsx` 做 SRP 拆分：
  - `lib/`：localStorage 读写、解析/normalize、纯函数 helper
  - `model/`：thread 列表/选择、streaming 事件 ingest、状态聚合等（以 hooks + reducer/纯函数为主）
  - `ui/`：页面布局、header/menus、composer、workbench panels 等
- 对 `TurnBlock.tsx` 做 SRP 拆分：
  - 把“统计/提取/格式化”等纯函数下沉到 `lib/turn/*`
  - 把复杂渲染拆成更小的 UI 子组件（保持 DOM/样式/行为一致）
- 迁移期允许在旧路径保留薄 shim（re-export）降低 import 爆炸面；最终收敛到 `@/features/codex-chat` Facade。

## Non-Goals
- 不引入新的状态管理库（Redux/Zustand 等）。
- 不改变 Codex Chat 的 UI/UX、交互细节与 VSCode plugin parity（以 [`openspec/specs/gui-codex-chat/spec.md`](../../specs/gui-codex-chat/spec.md) 与 [`docs/implementation-notes/coco-gui-codex-style/README.md`](../../../docs/implementation-notes/coco-gui-codex-style/README.md) 为准）。
- 不在本 change 内做“新增功能”（仅行为保持重构与目录迁移）。

## Impact
- Affected specs:
  - 行为保持：不修改 `gui-codex-chat` requirements（如发现必须调整，另起 change）
  - 结构性约束：依赖 `gui-frontend-architecture`（新增 capability）作为代码组织规则来源
- Likely affected code (implementation stage):
  - [`apps/gui/src/components/CodexChat.tsx`](../../../apps/gui/src/components/CodexChat.tsx)
  - `apps/gui/src/components/codex/**`
  - [`apps/gui/src/hooks/useSessionTree.ts`](../../../apps/gui/src/hooks/useSessionTree.ts)（可能迁移到 feature）
  - [`apps/gui/src/types/codex.ts`](../../../apps/gui/src/types/codex.ts)（可能迁移到 feature 或 shared 并通过 Facade 暴露）
- Likely affected docs:
  - [`docs/implementation-notes/coco-gui-codex-style/README.md`](../../../docs/implementation-notes/coco-gui-codex-style/README.md)（存在硬编码路径引用）

