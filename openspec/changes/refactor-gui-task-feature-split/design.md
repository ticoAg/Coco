# Design: refactor-gui-task-feature-split

## Target module layout (tasks)
目标目录（可渐进落地）：

```
apps/gui/src/features/tasks/
  index.ts                 # Facade（对外唯一入口）
  ui/
    TaskList.tsx
    TaskDetail.tsx         # 页面容器：tab 切换 + glue（尽量薄）
    NewTaskModal.tsx
    tabs/
      OverviewTab.tsx
      WorkbenchTab.tsx
      EventsTab.tsx
      ArtifactsTab.tsx
      SessionsTab.tsx
  model/
    useTasks.ts            # 数据获取 hooks（从旧 hooks 迁移）
    useTaskFiles.ts
    workbench.ts           # workbench nodes 组装/选择逻辑
  lib/
    format.ts              # formatDate/formatEpochMs 等纯函数
    preview.ts             # 预览策略选择（md/html/text）
  types/
    task.ts                # task 相关类型（必要时从 src/types/task.ts 迁移）
```

原则：
- “页面容器”组件保持薄：负责拿数据/切 tab/拼布局；复杂渲染拆分成 tab 子组件。
- 与 React 无关的逻辑（format、type guards、workbench key）下沉到 `lib/`。
- 数据获取与组装逻辑下沉到 `model/`（hooks）。

## Shared extraction: Text preview component
`TaskDetail` 与 `CodexChat` 都需要对文本内容做预览（Markdown/HTML/Plain）。为减少重复与保持一致性：
- 预览 UI 优先抽到 `src/shared/ui/TextPreview.tsx`
- feature 只负责提供 `content + path + 额外选项（如高度）`

迁移策略：
- 第一阶段：在 `tasks` 先接入 shared `TextPreview`
- 第二阶段：`codex-chat` 再切换到同一个 shared 组件（或反过来也可）

## Facade API
`features/tasks/index.ts` 对外暴露：
- `TaskList` / `TaskDetail`（页面级入口，供 App 组合）
- （必要时）少量类型（例如 `Task`）或 hooks

避免对外暴露 tab 子组件与内部 hooks（保持可演进性）。

## Risks & mitigations
- 风险：拆 tab 时引入 state 传递/重复请求问题。
  - 缓解：把数据获取上收敛到容器层（或 `model/` hooks），tab 只消费已准备好的数据。
- 风险：workbench node 类型与 key 逻辑变化导致选中状态丢失。
  - 缓解：在拆分前后保持 `workbenchNodeKey()` 规则不变；必要时先写一个小的纯函数单测（后续补）。

