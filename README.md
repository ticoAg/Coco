# Coco

<p align="center">
  <img src="apps/gui/src-tauri/app-icon.svg" width="120" alt="Coco logo" />
</p>

<p align="center">
  <strong>本地优先的 Codex 协作执行与任务落盘系统（WIP）</strong>
</p>

<p align="center">
  <a href="https://github.com/ticoAg/Coco/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/ticoAg/Coco/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/ticoAg/Coco" />
  </a>
  <a href="https://github.com/ticoAg/Coco/stargazers">
    <img alt="Stars" src="https://img.shields.io/github/stars/ticoAg/Coco?style=social" />
  </a>
  <img alt="Status" src="https://img.shields.io/badge/status-WIP-informational" />
</p>

---

## 目标（What / Why）

`Coco` 围绕 **Codex CLI** 构建一个「可复盘的本地协作执行闭环」：

- 把一次开发任务沉淀为 **Task Directory**（事件流、产物、人工介入点、证据索引）
- 把 Codex 当作“后台 coder/worker”，直接消费其 **结构化事件流** 进行编排与落盘
- 提供 GUI（Tauri）来浏览任务、回放事件、聚合证据与结果（持续迭代中）

> 当前状态：WIP（以设计与产物/运行时落地为主）

## 快速入口（Start Here）

- 项目导航（从这里开始）：[`Coco.md`](./Coco.md)
- 文档总索引：[`docs/README.md`](./docs/README.md)
- 落地文档索引（执行闭环 / Task Directory / GUI）：[`docs/coco/README.md`](./docs/coco/README.md)
- Codex adapter 说明：[`docs/coco/adapters/codex.md`](./docs/coco/adapters/codex.md)

## Quick Start（从源码运行 GUI）

### 1) 前置依赖

- Rust toolchain（stable）
- Node.js + npm
- `just`（用于运行仓库内命令）
- `codex`（**必须预装**，并确保 `codex` 在 `PATH` 可执行）
  - `Coco` 不会内置/分发 `codex`，请先按 `openai/codex` 的官方方式安装

> macOS 提示：如果你通过 Finder 启动 `.app`，GUI 可能拿不到 shell 的 `PATH`。
> 这时请设置 `COCO_CODEX_BIN` 指向 `codex` 的绝对路径，例如：
>
> ```bash
> export COCO_CODEX_BIN="/opt/homebrew/bin/codex"
> ```

### 2) 启动开发模式

```bash
just dev
```

### 3) 构建 release `.app`

```bash
just build
```

更多命令见：[`DEVELOPMENT.md`](./DEVELOPMENT.md) 或直接运行：

```bash
just --list --unsorted
```

## License

Apache-2.0（见 [`LICENSE`](./LICENSE)）。

## Legacy（历史归档）

根 `README.md` 里曾经包含更完整的编排概念与示意图，现已归档到：

- [`docs/coco/legacy/README.md`](./docs/coco/legacy/README.md)
- 旧版根 README 备份：[`docs/coco/legacy/root-readme-2026-01-19.md`](./docs/coco/legacy/root-readme-2026-01-19.md)

