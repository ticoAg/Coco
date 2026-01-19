# Docs

本目录用于沉淀 Coco 的工程化落地方案、实现细节笔记与外部参考资料。

## 快速入口（建议阅读顺序）

1) [`Coco.md`](../Coco.md)：项目导航页（你在找什么/应该看哪里）
2) [`docs/coco/README.md`](./coco/README.md)：落地方案索引（执行闭环、Task Directory、Codex adapter、GUI、roadmap）
3) [`openspec/`](../openspec)：规格真源（specs/changes；用于 validate 与收敛“可验证的契约”）
4) [`docs/implementation-notes/README.md`](./implementation-notes/README.md)：实现原理/机制笔记（对齐 Codex 与 GUI 行为）

## 目录索引

- [`docs/coco/`](coco)：Coco 落地与实施文档（产物规范、实现评估、路线图）
- [`docs/implementation-notes/`](implementation-notes)：实现原理与机制笔记（按外部系统/组件归档）
  - [`docs/implementation-notes/coco/`](implementation-notes/coco)：Coco 自身机制笔记（例如 Workbench State-Flow）
- [`docs/references/`](references)：外部参考资料快照（历史资料，不作为当前主线文档的一部分）

各目录下请维护对应 `README.md` 作为该层级索引与说明；避免再新增零散的“临时备忘”文件，统一沉淀到明确的归属目录中。
