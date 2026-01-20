---
summary: "Feature requirements and validation scope for readme-official"
doc_type: requirements
slug: "readme-official"
notes_dir: ".feat/20260120-0301-readme-official"
base_branch: "dev"
feature_branch: "feat/readme-official"
worktree: "../AgentMesh-feat-readme-official"
created_at_utc: "2026-01-20T03:01:27Z"
---
# Feature Requirements: readme-official

目标：把根 `README.md` 从“草率的导航页”升级为更适合 GitHub 首页展示的“官方化项目首页”，同时保持事实与仓库现状一致（不夸大、不写不存在的能力）。

## Status
- Current: vFinal
- Base branch: dev
- Feature branch: feat/readme-official
- Worktree: ../AgentMesh-feat-readme-official
- Created (UTC): 2026-01-20T03:01:27Z

## v0 (draft) - 2026-01-20T03:01:27Z

### Goals
- 根 `README.md` 更“官方化”：包含品牌区（icon + 项目名 + tagline + badges）、项目目标/定位、核心能力（简要）、Quick Start、从源码构建、关键入口（Docs/导航/架构）、状态说明（WIP/路线图入口）、License。
- 增加 GitHub Stars 展示（你提到的 “starview 组件”）：在 README 顶部可见（badge 或 star-history 图）。
- 明确 Codex 依赖“需要预装”：`codex` 必须可执行且在 `PATH`，并补充 GUI 场景下的 `COCO_CODEX_BIN` 提示。
- 给出“自己构建”的最小入口：使用仓库现有 `just` 命令（`just dev` / `just build`）说明 GUI 入口；必要时补充 CLI/Orchestrator 的入口链接（不新增不存在的步骤）。

### Non-goals
- 不改动业务逻辑/协议/架构实现（本 feature 仅做文档与展示优化）。
- 不新增/重排 docs 体系结构（除非 README 的入口链接需要同步调整）。
- 不引入复杂的文档生成器或额外依赖（例如必须安装某个网站构建工具；README 应该开箱可读）。

### Acceptance criteria
- `README.md` 顶部包含 icon（可在 GitHub 正常渲染）与 Stars 展示（可点击/可视化）。
- `README.md` 内的构建/运行命令与仓库事实一致（来自 `justfile` / `DEVELOPMENT.md`），不引入“跑不通”的指令。
- `README.md` 明确 Codex 依赖为“预装项”（并提供最小安装/定位说明）。
- README 仍提供清晰的文档入口（至少包含：`Coco.md`、`docs/README.md`、`docs/coco/README.md`、`docs/coco/adapters/codex.md`）。
- 若 README 新增/调整了 docs 入口或概念命名，需同步检查 `docs/README.md` 的索引一致性（必要时做最小修补）。

### Open questions
1) README 对外的项目名：继续使用 **Coco**，还是改成 **AgentMesh**（或 `Coco (AgentMesh)`）？
2) 你说的 “GitHub 的 starview 组件” 具体想要哪种？
   - 仅 Stars badge（shields.io / badgen）
   - Stars history 图（star-history.com 等）
   - 两者都要
3) Icon 来源：直接引用现有 `apps/gui/src-tauri/app-icon.svg` 作为 README logo，还是复制一份到更“稳定”的 `assets/` 或 `docs/assets/`？
4) README 语言：仅中文，还是中英双语（例如先中文后英文）？
5) Quick Start 侧重点：以 GUI `.app` 为主（`just dev` / `just build`），还是也需要补充 CLI `coco` 的安装/运行说明？

### Options / trade-offs
- Stars 展示
  - Option A：`shields.io` / `badgen`（轻量、常见；依赖第三方 badge 服务）
  - Option B：Stars history 图（更直观；图片较大、依赖第三方站点）
  - Option C：两者都放（信息更全；README 更长）
- Icon
  - Option A：复用 `apps/gui/src-tauri/app-icon.svg`（单一真源；路径未来若调整需同步）
  - Option B：复制到 `assets/logo.svg`（README 资源更“语义化”；但会产生重复文件）

### Verification plan
- Manual steps:
  - 在 GitHub 渲染预览：确认 icon、badge、代码块、链接可用（尤其是相对路径链接）。
  - 本地核对命令：`just --list`、`just dev` / `just build`（如你希望我在本机跑一遍也可以）。

## vFinal - 2026-01-20

确认结论（用户确认“以当前 README 为最终交付版本”）：

- 项目名：保持 `Coco`
- Stars 展示：使用 Stars badge（README 顶部）
- Icon：复用 `apps/gui/src-tauri/app-icon.svg`（README 顶部 logo）
- README 语言：中文
- Quick Start：以 GUI 为主（`just dev` / `just build`）

验收标准（vFinal）：

- `README.md` 的首页展示信息更完整（品牌区 + 目标 + 能力概览 + Quick Start + 构建方式 + Docs 入口），且不夸大与仓库事实一致。
- 明确 `codex` 为预装依赖（并保留 GUI 场景 `COCO_CODEX_BIN` 的提示）。
- README 仍清晰指向文档系统入口（`Coco.md` / `docs/README.md` / `docs/coco/README.md` / `docs/coco/adapters/codex.md`）。
