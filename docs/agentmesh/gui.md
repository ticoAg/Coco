# AgentMesh GUI（Artifacts-first）

> 目标：用户感知到的入口是 **GUI**。GUI 不需要嵌入/复刻各家 TUI，只需要把“任务产物 + 介入点 + 事件流”呈现清楚，并提供审批/补充/重跑等交互。

## 1. 一种可行形态：本地 Web GUI + 本地 Orchestrator（示例：FastAPI / Express）

### 组件拆分（语言无关）

- **agentmesh-orchestrator（本地后台服务）**
  - 管理 coder session（Codex-first：`codex app-server` / `codex exec --json`）
  - 写入任务目录 `.agentmesh/tasks/<task_id>/...`（事实来源）
  - 将关键状态与事件流对外提供给 GUI（HTTP + SSE/WebSocket）
- **agentmesh-gui（Web）**
  - 读取并展示任务目录的结构化产物（报告/契约/决策/事件）
  - 让用户编辑 `human-notes.md`、`context-manifest.yaml`
  - 对 approval/gate 做 allow/deny，并触发 orchestrator 继续执行

> 说明：这样 GUI 只依赖 agentmesh-orchestrator 的 API，而任务目录仍然是稳定、可迁移、可离线查看的“最终交付物”。

### 1.1 技术选型（可选组合示例）

以下是常见的拆分方式与可选实现（不影响“任务目录 = 最终产物”这一点）：

- **后端（orchestrator）：本地后台服务**
  - 示例实现：Python + FastAPI；Node + Express/Fastify
  - 用途：对接 `codex app-server`（stdio JSONL），并对 GUI 暴露 HTTP + SSE/WS。
- **前端（GUI）：React + Vite + TypeScript**
  - 用途：实现任务列表/任务详情/审批弹窗/事件流等信息密集型页面。
  - 补充：与后端 Python 无冲突；前端只消费 orchestrator 的 API 与任务目录抽象。

也可以把后端换成其他语言/框架（例如 Node/Rust），只要能满足：

- 与 `codex app-server` 的 stdio JSONL 双向通信
- 对 GUI 的 HTTP API（以及 SSE/WS 推送）
- 对任务目录的落盘与索引

### 1.2 打包为“一个应用”（可行）

前端与后端可以被封装到一个可安装应用中，常见做法是“桌面壳 + 内置本地服务”：

- **桌面应用壳**：负责承载 Web UI，并在启动时拉起/管理本地 orchestrator 进程
  - 例：Tauri（Rust + Web UI）或 Electron（Node + Web UI）
- **内置本地服务（orchestrator）**：随应用一起分发（或内嵌），提供 HTTP + SSE/WS，并与 Codex 交互
  - Python 版本常见做法：PyInstaller/类似工具将 orchestrator 打包为可执行文件，由桌面壳启动

不论以何种方式打包，任务的最终交付物仍然可以保持为：

- `.agentmesh/tasks/<task_id>/` 的目录快照（可导出 zip/tar），便于迁移、审计与复盘。

## 2. GUI 信息架构（页面结构）

### 2.1 任务列表页

- 列出 `.agentmesh/tasks/` 下所有任务
- 状态：created / working / gate.blocked / completed / failed
- 最近活动：最后事件时间、最后产物更新时间
- 快捷入口：继续/查看/归档/导出（zip）

### 2.2 任务详情页（Tabs 形式）

- **Overview**：目标、里程碑、roster、当前 gates、Next Actions
- **Reports**：`shared/reports/*`（结构化报告 + diff）
- **Contracts**：`shared/contracts/*`（API Contract / Error Model / Schema）
- **Decisions**：`shared/decisions/*`（ADR/权衡/结论）
- **Events**：`events.jsonl`（可过滤：turn/item/artifact/gate）
- **Sessions**：每个 `agents/<instance>/` 的 session 概览
  - `session.json`（threadId/cwd/rolloutPath）
  - `runtime/events.jsonl`（Codex 原始事件）
  - `artifacts/*`（该 session 产物）

### 2.3 Gate / Approval 弹窗（核心交互）

当 Codex 发出 approval request（applyPatch / execCommand 等）：

- GUI 弹窗显示：请求原因、命令/文件变更摘要、风险提示、与任务目标的关联
- 用户操作：Allow / Deny / “补充约束并继续”（写入 `human-notes.md` 后 allow）
- 结果：写入 `task.yaml` 与 `events.jsonl`，并把决策回传给 Codex

## 3. Orchestrator ↔ GUI 的最小 API（示例）

> GUI 只做呈现与决策，真正的“跑一轮 turn”由 orchestrator 驱动。

- `GET /api/tasks`：任务列表（从 `.agentmesh/tasks/` 扫描/索引）
- `GET /api/tasks/:taskId`：任务详情（task.yaml + 索引信息）
- `GET /api/tasks/:taskId/events`：任务事件（可分页/过滤）
- `POST /api/tasks/:taskId/turn`：触发一次 turn（指定 agent instance + input + attachments）
- `POST /api/tasks/:taskId/gates/:gateId/decision`：allow/deny + commentRef
- `GET /api/stream`：SSE 或 WS，推送任务状态变化、gate、artifact 更新

> 实现上可以使用 SSE 或 WS 来推送状态变化、gate、artifact 更新；SSE 能覆盖“实时刷新 + gate 弹窗”的核心需求。

## 4. “最终产物”的定义（GUI 与交付）

用户最终交付/可迁移的产物可以定义为：

- 一个任务目录 `.agentmesh/tasks/<task_id>/` 的完整快照（含 reports/contracts/decisions/events/runtime）
- GUI 提供 “Export Task” 把该目录打包为 zip/tar（便于分享、审计、复盘）

GUI 只是入口与操作面板，任务目录是最终可复现交付物。
