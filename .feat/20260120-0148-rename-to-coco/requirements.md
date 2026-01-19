---
summary: "将项目全局重命名为 Coco"
doc_type: requirements
status: "vFinal"
slug: "rename-to-coco"
notes_dir: ".feat/20260120-0148-rename-to-coco"
base_branch: "dev"
created_at: "2026-01-20"
---

# 需求 (vFinal)

## 目标
- 将本项目内的对外/对内命名统一调整为 `Coco` / `coco`（覆盖代码、配置、文档、构建产物、UI 展示、OpenSpec 等）。
- 将工作区落盘目录规范调整为 `.coco/`（不提供兼容层）。
- 将环境变量前缀调整为 `COCO_*`（不提供兼容层）。

## 非目标
- 不引入新功能；仅做等价重命名（不做兼容/迁移）。
- 不修改 `~/Documents/myws/ags/codex`（上游 repo）。
- 不重命名本地顶层目录（本机仓库文件夹名不要求改；只修改仓库内容）。

## 影响范围（初步）
- Rust crate/package 名、二进制名、workspace 名等（`Cargo.toml` / `crates/*`）。
- Node/前端包名（如 `package.json` / `apps/gui/*`）。
- 配置与脚本（`justfile`、`scripts/*`、CI 配置）。
- 文档系统（`docs/*`、`README.md`、`Coco.md` 等）。
- 工作区落盘目录与环境变量（例如 `.coco/`、`COCO_*`）。
- 代码内字符串、命名空间、目录名、导入路径、UI 文案等。

## 验收标准
- 全仓不再出现旧项目名及其派生（含旧落盘目录名与旧环境变量前缀）。
- Rust workspace 构建/测试通过（`cargo test --workspace --exclude coco-app`）。
- GUI 构建通过（`npm -C apps/gui run build`）。
- OpenSpec 校验通过（`openspec validate --specs --strict`）。

## 风险与注意事项
- 破坏性变更：包名/二进制名变化可能影响下游脚本、CI、用户环境变量。
- 路径大小写差异可能在不同 OS 上产生隐患（macOS 默认大小写不敏感）。
- 外部发布（crate/npm）若存在，需要迁移策略（重定向/废弃声明）。

## 已确认决策
- 仅修改本项目内出现的名字（不涉及外部系统）。
- 对外品牌名使用 `Coco`；代码/路径等使用 `coco`（按上下文映射大小写）。
- 不提供兼容层：不保留旧命令/旧包名/旧落盘目录/旧环境变量。
- 顶层目录（本机仓库文件夹名）不改。
- OpenSpec：spec-id 与内容均同步改名。

## 验证计划（占位）
- 在确认仓库的实际构建/测试命令后补全（例如 `just test` / `cargo test` / `pnpm test` 等）。
