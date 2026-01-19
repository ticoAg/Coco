# Design: refactor-gui-codex-chat-feature-split

## Target module layout (codex-chat)
目标目录（可渐进落地，不要求一次到位）：

```
apps/gui/src/features/codex-chat/
  index.ts               # Facade（对外唯一入口）
  ui/
    CodexChat.tsx        # 页面容器：layout + glue（尽量薄）
    header/
    composer/
    panels/              # edit/preview/workbench 等面板 UI
    sidebar/             # session tree UI（从现有 sidebar 迁移）
    turn/                # TurnBlock & 子组件
  model/
    useCodexChatState.ts # state 聚合（hooks/reducer）
    useCodexEvents.ts    # streaming ingest（对接 apiClient/tauri events）
  lib/
    storage.ts           # settings/pinned items/sessionTreeWidth
    parsing.ts           # parse/normalize helpers（纯函数）
    turn/                # TurnBlock 相关纯函数（extract/count/format）
  types/
    ...                  # CodexChat 内部类型（必要时从旧路径迁移）
```

核心原则：
- UI 组件尽量“只渲染 + 回调”，状态与副作用（events、localStorage）通过 hooks 下沉到 `model/`。
- 纯函数 helper 下沉到 `lib/`，避免散落在大组件文件内部，便于单测（后续可补）。

## Facade API
`features/codex-chat/index.ts` 对外只暴露：
- `CodexChat` 顶层组件（页面级入口）
- 必要的 `types`（若其它 feature 或 app 需要）
- （可选）少量稳定 hooks（例如 app 需要读取当前 thread 信息时）

不对外暴露：
- `ui/*` 内部组件（避免跨 feature 直接依赖内部结构）

## TurnBlock 拆分策略
`TurnBlock.tsx` 的拆分以“保持渲染行为一致”为前提：
- 把与 React 无关的逻辑（例如 heading 提取、exploration 统计、mcp 格式化、ansi 渲染 helper）搬到 `lib/turn/*`。
- UI 子组件按 entry kind 拆分（command/fileChange/mcp/webSearch/error/reasoning 等），但保持 props 尽量结构化（减少 prop drilling 与隐式耦合）。

## Migration approach
为降低风险，建议分两步（可在同一 change 内完成）：
1) **搬家优先**：先把现有文件迁到 `features/codex-chat`，用最小 diff 更新 import。
2) **拆分再优化**：在新目录里逐步拆出 hooks/lib/ui 子组件，减少 `CodexChat.tsx` 与 `TurnBlock.tsx` 体积。

迁移期兼容策略（与 `gui-frontend-architecture` 一致）：
- 可以在旧路径保留薄 shim 文件，保证其它地方 import 不需要一次性全改。
- 本 change 末尾优先把 app 入口收敛到 `@/features/codex-chat`。

## Risks & mitigations
- 风险：`CodexChat` 涉及 tauri events 与 streaming 状态，拆分时容易引入“闭包/依赖数组”类 bug。
  - 缓解：先提纯函数与 storage，再提 hooks；每一步都跑 `npm -C apps/gui run build` 并做手动冒烟。
- 风险：文档/注释中硬编码路径（尤其 parity 文档）。
  - 缓解：本 change 明确包含 doc 更新任务，并尽量把文档引用改为更稳定的入口（Facade 或新的路径）。

