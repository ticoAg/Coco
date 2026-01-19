---
summary: "重命名为 Coco 的上下文定位与证据（滚动更新）"
status: "draft"
slug: "rename-to-coco"
created_at: "2026-01-20"
---

# 上下文定位 (Kickoff)

> 本文档记录：入口、命名出现位置、可能受影响的模块边界。只记录关键锚点，不粘贴大段内容。

## 初始观察
- 仓库根存在 `README.md` 与 `Coco.md`，均以 “Coco” 作为对外名称入口：`README.md:1`、`Coco.md:1`。
  - `README.md:1` 标题为 `# Coco`
  - `Coco.md:1` 标题为 `# Coco 项目导航（Start Here）`
- 文档系统入口 `docs/README.md` 明确引用 `Coco.md` 与 `docs/coco/`：`docs/README.md:3`、`docs/README.md:7`、`docs/README.md:14`。
- 仓库同时包含 Rust workspace（`Cargo.toml`/`crates/`）与前端 `apps/`（Tauri + Vite/React）。

## 关键命名锚点（已确认）

### Rust workspace / crates
- Workspace 成员目录以 `coco-*` 命名：`Cargo.toml:4`-`Cargo.toml:8`。
- CLI crate：`crates/coco-cli/Cargo.toml:2`（package 名 `coco-cli`），且二进制名为 `coco`：`crates/coco-cli/Cargo.toml:7`。
- Core crate：`crates/coco-core/Cargo.toml:2`（package 名 `coco-core`）。
- Orchestrator crate：`crates/coco-orchestrator/Cargo.toml:2`（package 名 `coco-orchestrator`）。
- Codex adapter crate：`crates/coco-codex/Cargo.toml:2`（package 名 `coco-codex`）。

### GUI / Tauri
- GUI npm 包名：`apps/gui/package.json:2`（`"name": "coco-gui"`）。
- Tauri Rust 包名与描述：`apps/gui/src-tauri/Cargo.toml:2`（`coco-app`）、`apps/gui/src-tauri/Cargo.toml:4`（`Coco (macOS)`）。
- Tauri app 标识与 UI 文案：`apps/gui/src-tauri/tauri.conf.json:3`（`productName`）、`apps/gui/src-tauri/tauri.conf.json:5`（`identifier`）、`apps/gui/src-tauri/tauri.conf.json:15`（window title）。

### Docs / OpenSpec
- OpenSpec 已存在 `coco-cli` spec：`openspec/specs/coco-cli/spec.md`（后续需要一并评估是否迁移/重命名）。
- `.coco/` 作为核心落盘目录在项目上下文中被明确约束：`openspec/project.md:4`、`openspec/project.md:36`。
- 当前 OpenSpec 存在进行中的 change（实现未完成，重命名可能与其产生冲突）：`openspec list --long`（`refactor-gui-codex-chat-feature-split`、`refactor-gui-task-feature-split`）。

## 待补充
- 全仓 `Coco/coco` 命名出现清单（目前 `rg` 粗略统计命中约 123 个文件；需按类别收敛为可执行迁移清单）。
- 构建/测试入口命令与 CI 入口。
