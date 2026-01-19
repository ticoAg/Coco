---
summary: "交付记录：rename-to-coco"
status: "done"
slug: "rename-to-coco"
created_at: "2026-01-20"
---

# 交付说明

## 做了什么
- 全仓将项目命名统一为 `Coco/coco`（代码、配置、文档、OpenSpec）。
- 目录/文件重命名（`git mv`）：
  - 项目导航页更名为 `Coco.md`
  - `crates/*`：`coco-core` / `coco-cli` / `coco-orchestrator` / `coco-codex`
  - `docs/coco`、`docs/implementation-notes/coco*`
  - OpenSpec：`openspec/specs/coco-cli`，以及归档 change 目录同步改名
- 工作区落盘目录规范改为 `.coco/`，环境变量前缀改为 `COCO_*`（不兼容旧前缀）。
- GUI/Tauri：更新 productName/title/identifier，npm 包名更新为 `coco-gui`。
- CI：更新 `cargo --exclude coco-app` 等命令与相关引用。

## 为什么
- 项目正式更名为 Coco，避免新旧命名混用导致的文档/脚本/产物不一致。

## 影响
- **破坏性变更**：CLI 命令、crate/package 名、落盘目录名、环境变量前缀均已切换为新命名；不提供兼容层。
- **数据隔离**：旧目录/旧前缀写入的数据不会被新版本读取（符合“不兼容”约束）。

## 如何验证
- Rust：
  - `cargo test --workspace --exclude coco-app`
- GUI：
  - `npm -C apps/gui ci`
  - `npm -C apps/gui run build`
- OpenSpec：
  - `openspec validate --specs --strict`
  - `openspec validate --changes --strict`
