---
summary: "Evidence-first context notes for readme-official"
doc_type: context
slug: "readme-official"
notes_dir: ".feat/20260120-0301-readme-official"
created_at_utc: "2026-01-20T03:01:27Z"
---
# Context Notes

目标：记录最小但关键的上下文证据（入口、现状、约束、关键定位）。
要求：用 `path:line` 锚点，避免把大段日志贴进对话。

## Entrypoints
- `README.md:1` - 根 README（GitHub 首页展示），本 feature 的主要改动目标与交付物。  
- `Coco.md:1` - 项目导航页（“从这里开始”）。  
- `docs/README.md:1` - 文档总索引入口。  
- `DEVELOPMENT.md:14` - 开发/构建前置依赖（包含 `codex` 预装要求与 `COCO_CODEX_BIN` 提示）。  
- `justfile:41` - `just dev` / `just build` 等最小可运行入口。  
- `apps/gui/src-tauri/app-icon.svg:1` - 现成的 App icon 源文件，可复用为 README 顶部 logo。  

## Current behavior
- 变更前：根 `README.md` 以“导航入口 + Legacy 指针”为主，缺少 GitHub 仓库首页常见的品牌区与 Quick Start（可参考 git 历史/本 feature diff）。
- 变更后：根 `README.md` 已补齐 logo + badges + 目标简介 + Quick Start（`README.md:3` / `README.md:26` / `README.md:43`）。
- Rust + Tauri 的开发/构建说明主要集中在 `DEVELOPMENT.md`（见 `DEVELOPMENT.md:1`）。

## Constraints / assumptions
- 本仓库依赖 `codex` CLI：需要用户预装并在 `PATH` 可用（`DEVELOPMENT.md:20`）。
- GUI 场景（Finder 启动 `.app`）可能拿不到 shell `PATH`，需要 `COCO_CODEX_BIN`（`DEVELOPMENT.md:21`）。
- 构建/运行入口以 `just` 为主（`justfile:4` / `justfile:41` / `justfile:80`）。
- GitHub 仓库信息以本地 `git remote -v` 为准（当前显示为 `ticoAg/Coco`；命令可复现：`git remote -v`）。

## Related tests / fixtures
- 本次变更为文档与展示优化，预计不涉及测试用例变更。
