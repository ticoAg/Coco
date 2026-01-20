---
summary: "Decision log for disagreements and trade-offs"
doc_type: disagreements
slug: "readme-official"
notes_dir: ".feat/20260120-0301-readme-official"
created_at_utc: "2026-01-20T03:01:27Z"
---
# Disagreement Log

当需求/方案存在分歧时，用这里显式记录，并给出选项与 trade-off（然后停下等用户选择）。

- Topic: README 对外项目名/品牌（Coco vs AgentMesh）
  - Option A: 保持 `Coco`（与当前 README、目录内文档、Tauri App 名称一致）
  - Option B: 对外改为 `AgentMesh`（或 `Coco (AgentMesh)` 过渡）
  - Decision: Option A（保持 Coco）
  - Notes: 已确认对外品牌名保持一致。

- Topic: GitHub Stars 展示形式（“starview 组件”）
  - Option A: Stars badge（`shields.io` / `badgen`，轻量，放在标题下）
  - Option B: Stars history 图（star-history.com 等，直观但占位大）
  - Option C: 两者都要（信息更全，但 README 更长）
  - Decision: Option A（Stars badge）
  - Notes: 若仓库私有/不可被第三方服务访问，badge/图可能无法渲染。

- Topic: README 顶部 Icon 来源/放置位置
  - Option A: 直接引用 `apps/gui/src-tauri/app-icon.svg`（单一真源，零复制）
  - Option B: 复制一份到 `assets/logo.svg` 或 `docs/assets/logo.svg`（语义更清晰、路径更稳定；但会产生重复）
  - Decision: Option A（直接引用 app-icon.svg）
  - Notes: GitHub 对相对路径 svg 渲染通常没问题；若你希望未来迁移 GUI 目录结构，Option B 更稳。

- Topic: README 语言策略
  - Option A: 仅中文（与当前仓库文档风格一致）
  - Option B: 中英双语（先中文后英文，便于开源传播）
  - Decision: Option A（仅中文）
  - Notes: 双语会显著拉长 README。

- Topic: Quick Start 侧重点（GUI vs CLI）
  - Option A: GUI 为主（`just dev` / `just build` + `.app` 入口）
  - Option B: GUI + CLI 都写（补充 `coco` CLI 的定位与用法入口）
  - Decision: Option A（GUI 为主）
  - Notes: 当前 `DEVELOPMENT.md` 描述 CLI 仍偏 MVP/可选（`DEVELOPMENT.md:9`）。
