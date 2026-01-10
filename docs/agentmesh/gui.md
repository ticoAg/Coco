# AgentMesh GUI（Artifacts-first）

> 目标：用户感知到的入口是 **GUI**。GUI 不需要嵌入/复刻各家 TUI，只需要把“任务产物 + 事件流 + 状态”呈现清楚。
>
> 你当前选择的落地方式是：**CLI 负责编排与执行，GUI 只做可视化/读取任务目录**；审批/补充/重跑等“写操作”可以先由主控（主 Codex TUI）通过 CLI 完成，后续再逐步把交互搬进 GUI。

## 1. 一种可行形态：macOS `.app`（Tauri：Rust 后端 + Web UI）

### 组件拆分（语言无关）

- **Rust Orchestrator（CLI，短进程）**
  - 形式：一个 `agentmesh` 可执行文件（可被主 Codex 会话通过 `shell` 调用）
  - 职责：spawn/resume/cancel/join，写入任务目录 `.agentmesh/tasks/<task_id>/...`
  - 执行：Codex-first 先用 `codex exec --json`；后续可接 `codex app-server`
  - 依赖：`codex` 可执行文件只依赖 PATH（不随 `.app` 打包）
- **GUI（macOS `.app`，Web UI）**
  - 只读：读取并展示任务目录的结构化产物（报告/契约/决策/事件、subagents events）
  - 实时：用文件系统 watcher/轮询刷新状态（无需常驻后端服务）

> 说明：这种拆分里，“任务目录”就是稳定、可迁移、可离线查看的最终交付物；GUI 不需要承载编排器，也不需要在本机额外跑 HTTP 服务。

### 1.1 技术选型（可选组合示例）

以下是常见的拆分方式与可选实现（不影响“任务目录 = 最终产物”这一点）：

- **后端（orchestrator）：Rust CLI**
  - 用途：对接 `codex exec --json`（子进程 + JSONL），负责任务目录落盘与并发控制。
- **前端（GUI）：React + Vite + TypeScript + Tailwind**
  - 用途：实现任务列表/任务详情/审批弹窗/事件流等信息密集型页面。
  - 补充：前端只消费任务目录抽象（必要时通过 Tauri 读文件 API）。

也可以把后端换成其他语言/框架，只要能满足：

- 与 `codex app-server` 的 stdio JSONL 双向通信
- 对 GUI 的 IPC / API（以及事件推送）
- 对任务目录的落盘与索引

### 1.2 打包为“一个应用”（可行）

macOS-only 的 `.app` 里可以包含：

- GUI（Tauri）本身
- （可选）随包附带 `agentmesh` CLI 作为 helper（二进制由 Rust 构建产出）

但 **不包含** `codex`：用户需要自行安装 `codex` 并确保它在 PATH 中。

## 2. GUI 信息架构（页面结构）

### 2.1 任务列表页

- 列出 `.agentmesh/tasks/` 下所有任务
- 状态：created / working / input-required / completed / failed / canceled
- 最近活动：最后事件时间、最后产物更新时间
- 快捷入口：继续/查看/归档/导出（zip）

### 2.2 任务详情页（Tabs 形式）

- **Overview**：目标、里程碑、roster、当前 gates、Next Actions
- **Reports**：`shared/reports/*`（结构化报告 + diff）
- **Contracts**：`shared/contracts/*`（API Contract / Error Model / Schema）
- **Decisions**：`shared/decisions/*`（ADR/权衡/结论）
- **Events**：`events.jsonl`（可过滤：turn/item/artifact/gate）
- **Subagents / Sessions**：每个 `agents/<instance>/` 的 subagent session 概览（并行执行、状态、输出）
  - `session.json`（threadId/cwd/rolloutPath）
  - `runtime/events.jsonl`（Codex 原始事件）
  - `artifacts/*`（该 session 产物）

### 2.3 Gate / Approval 弹窗（核心交互）

当 Codex 需要人类输入/审批（例如 applyPatch / execCommand）时：

- MVP：GUI 只展示 `gate.blocked` 的原因与指引（例如指向 `shared/human-notes.md`）
- 决策执行：由主控（主 Codex TUI）通过 `agentmesh` CLI 完成 allow/deny/resume
- Phase 2+：再把 allow/deny 交互迁移到 GUI（届时更适合切到 `codex app-server`）

## 3. GUI ↔ 任务目录：最小读接口（建议：Tauri + 文件 watcher）

GUI 不需要直接控制 orchestrator；它只需要读任务目录并做到“实时刷新”。

建议最小能力：

- 列表：扫描 `.agentmesh/tasks/` 列出任务
- 详情：读取 `task.yaml` + `events.jsonl`
- subagents：读取 `agents/<id>/runtime/events.jsonl` + `agents/<id>/artifacts/final.json`
- 实时：对上述文件做 watcher/轮询（Tauri 后端推送 `task.updated` 等事件也可以，但本质仍来自文件变化）

## 3.1 Subagents（并行 workers）在 GUI 的呈现（建议）

当 AgentMesh 使用 `codex exec --json` 跑并行 subagents 时，GUI 需要直观回答三个问题：

1) 现在有哪些 subagents 在跑？分别在做什么？
2) 哪个 subagent 先完成了？它交付了什么？
3) 还有哪些 subagents 没完成？主控是继续拆分、等待，还是先 join 一部分结果？

建议在任务详情页的 **Subagents / Sessions** tab 中提供：

- **Subagent 列表**：`queued/running/blocked/completed/failed/cancelled` + 最近事件时间
- **当前活动**（从 `item.*` 推导）：
  - 正在执行的命令（command_execution）
  - 最近文件变更（file_change）
  - todo_list 当前步骤
- **（可选）快捷指令**：GUI 复制出 `agentmesh` CLI 命令（cancel/resume/open-worktree 等），由主控去执行
- **完成即提示**：文件 watcher 观测到 terminal 状态时 toast，并将该 subagent 置顶

> 备注：`codex exec --json` 约定 stdout 只输出 JSONL 事件，适合 GUI/Orchestrator “只读 stdout”实现稳定解析。

## 4. “最终产物”的定义（GUI 与交付）

用户最终交付/可迁移的产物可以定义为：

- 一个任务目录 `.agentmesh/tasks/<task_id>/` 的完整快照（含 reports/contracts/decisions/events/runtime）
- GUI 提供 “Export Task” 把该目录打包为 zip/tar（便于分享、审计、复盘）

GUI 只是入口与操作面板，任务目录是最终可复现交付物。
