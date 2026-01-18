# AgentMesh GUI（Artifacts-first）

> 目标：用户感知到的入口是 **GUI**。GUI 不需要嵌入/复刻各家 TUI，只需要把“任务产物 + 事件流 + 状态”呈现清楚。
>
> 你当前选择的落地方式是：**GUI 作为统一入口**；编排器能力以内置 Rust 后端（Tauri）提供，并写入任务目录 `.agentmesh/tasks/<task_id>/...`。
> `agentmesh` CLI 可以作为可选 wrapper（脚本/自动化/内部 helper），但不是必须入口。
>
> 补充：在保持 “Artifacts-first” 的前提下，GUI 也可以提供一个 **Codex Chat** 视图，用 `codex app-server` 做原生对话（会话列表、流式事件、内联审批），而不是复刻 TUI。

> multi/subagent 的完整闭环（Orchestrator 模型 + Controller 状态机 + Evidence-first）见：[`docs/agentmesh/multiagent.md`](./multiagent.md)。
>
> 术语约定：本文中的“后端编排器”更准确叫 **Controller（程序状态机）**；“Orchestrator（模型）”负责规划/分解，输出结构化 actions，由 Controller 执行。

> 注：当前仓库内 `agentmesh` CLI 的实现为 MVP，先覆盖 `task create|list|show|events` 与 `--json`；
> subagent 的 spawn/resume/cancel/join 等编排命令在后续 changes 中补齐。

## 1. 一种可行形态：macOS `.app`（Tauri：Rust 后端 + Web UI）

### 组件拆分（语言无关）

- **Rust Controller（内置后端，可选 CLI）**
  - 形式：Rust crate（Tauri 后端内置）；也可提供 `agentmesh` 可执行文件作为可选 wrapper
  - 职责：写入任务目录 `.agentmesh/tasks/<task_id>/...`（规划：spawn/resume/cancel/join；当前 MVP：task/events）
  - 执行：并行 subagents/worker 优先用 `codex exec --json`；需要“原生对话 + 内联审批”的交互则使用 `codex app-server`
  - 依赖：`codex` 可执行文件只依赖 PATH（不随 `.app` 打包）
- **GUI（macOS `.app`，Web UI）**
  - 以只读展示为主：读取并展示任务目录的结构化产物（报告/契约/决策/事件、subagents events）
  - 实时：用文件系统 watcher/轮询刷新状态（无需常驻后端服务）

> 说明：这种拆分里，“任务目录”就是稳定、可迁移、可离线查看的最终交付物；GUI 不需要承载编排器，也不需要在本机额外跑 HTTP 服务。

### 1.1 技术选型（可选组合示例）

以下是常见的拆分方式与可选实现（不影响“任务目录 = 最终产物”这一点）：

- **后端（Controller）：Rust crate（Tauri 内置；可选 CLI wrapper）**
  - 用途：对接 `codex exec --json`（子进程 + JSONL），负责任务目录落盘与并发控制。
- **前端（GUI）：React + Vite + TypeScript + Tailwind**
  - 用途：实现任务列表/任务详情/审批交互/事件流等信息密集型页面。
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

### 2.3 Codex Chat（原生对话）

当你需要“在 GUI 内直接与 Codex 对话”，并且希望具备与 `codex-cli` 对齐的核心交互（会话列表、流式输出、工具/文件/搜索事件展示、审批策略）时，可以在 GUI 增加一个 **Codex Chat** 视图：

- 进程/协议：由 Tauri Rust 侧直接启动系统 PATH 中的 `codex app-server`，通过 stdio JSON-RPC 进行双向通信。
- 会话历史：复用 `~/.codex/sessions`（对应 app-server 的 `thread/list`），按最近更新时间排序，显示 `threadId` + `preview` 摘要。
- 会话树交互轮数：左侧会话树的 task/orchestrator/worker 节点用“用户输入 + AI 输出”累计轮数替代图标显示（每个 user message +1，AI 每轮 +1）。
- 工作目录（workspace root）：GUI 顶部提供主入口（Current/Recent/Open Project/New Window/About/Updates）可切换工作目录与相关操作；切换后会重启 `codex app-server` 并默认开启新会话。工作目录与最近项目（最多 5 条）都会持久化到 App Data（默认优先级低于环境变量 `AGENTMESH_WORKSPACE_ROOT`）。
- 输入区覆盖：仅提供 `model` 与 `model_reasoning_effort` 的快捷选择（其余配置从 `~/.codex/config.toml` 读取）；`model` 选项来自 `model/list`，若存在 profiles 则合并 `profiles.*.model` 并去重，空集则回退 `gpt-5.2` / `gpt-5.2-codex`。
- 图片输入：支持通过 `+` 选择图片、或在输入框中粘贴图片；一次可发送多张，单张最大 5MB；消息气泡中显示缩略图。
- Profile 选择：当 `config.toml` 定义 `profiles` 时，底部状态栏展示 profile 下拉；切换仅影响当前 GUI 会话，会重启 app-server 并恢复当前 session（若当前 turn 进行中需确认）。
- Fork/Rollback（增强）：在 Codex Chat 中暴露 `thread/fork` 与 `thread/rollback`，用于验证 fork 继承与“清理主线程历史”的交互边界（注意：rollback 只回滚历史，不回滚文件修改）。
- Auto context（轻量 repo 包装）：当开启 Auto context 时，GUI 会在发送给 Codex 的文本前追加一个固定格式的 header（包含当前 repo 与最多 3 个 related repo 的绝对路径），以便模型自行按路径读取/定位相关文件；聊天区展示实际发送给 Codex 的文本；GUI 顶部 repo selector 仅显示 repo 名称，悬停显示绝对路径，related repo 悬停右侧出现红色 `-` 可移除（会话级，new session 重置）。
- 配置入口：在 GUI 内打开一个面板，直接编辑 `~/.codex/config.toml`（路径按平台 HOME 目录解析）。
- 审批交互：当 Codex 请求命令/文件变更审批时，不弹模态框；以**会话消息**形式渲染「批准/拒绝」按钮，点击后回传给 Codex。
- macOS 注意：从 Finder 启动 `.app` 时，GUI app 可能不继承 shell 的 PATH。GUI 会尝试通过 `$SHELL -lic` 同步 PATH；如仍遇到 “codex not found on PATH”，可设置环境变量 `AGENTMESH_CODEX_BIN=/opt/homebrew/bin/codex`（或从 Terminal 启动）。

> 注意：`~/.codex/config.toml` 可能包含敏感信息（例如凭据/令牌/账号配置），GUI 编辑等价于直接编辑该文件，请按需控制显示与日志。

### 2.4 Gate / Approval（任务编排层，核心交互）

当 Codex 需要人类输入/审批（例如 applyPatch / execCommand）时：

- MVP：GUI 只展示 `gate.blocked` 的原因与指引（例如指向 `shared/human-notes.md`）
- 决策执行：由主控通过 `agentmesh` 控制面完成 allow/deny/resume（可选 CLI wrapper；也可通过 GUI 内置后端暴露为接口）
- 说明：当采用 `codex app-server` 驱动 **Codex Chat** 时，命令/文件变更审批可以直接在消息流内完成；任务编排层的 `gate.blocked` 仍然是“可人工介入”的统一锚点。

## 3. GUI ↔ 任务目录：最小读接口（建议：Tauri + 文件 watcher）

GUI 的核心职责是读任务目录并做到“实时刷新”；写操作可由内置 Controller 接口（或可选 CLI wrapper）承担。

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
- **（可选）快捷指令**：GUI 复制出可执行指令（例如 `agentmesh` CLI wrapper 命令：cancel/resume/open-worktree 等），由主控去执行
- **完成即提示**：文件 watcher 观测到 terminal 状态时 toast，并将该 subagent 置顶

> 备注：`codex exec --json` 约定 stdout 只输出 JSONL 事件，适合 GUI/Orchestrator “只读 stdout”实现稳定解析。

## 4. “最终产物”的定义（GUI 与交付）

用户最终交付/可迁移的产物可以定义为：

- 一个任务目录 `.agentmesh/tasks/<task_id>/` 的完整快照（含 reports/contracts/decisions/events/runtime）
- GUI 提供 “Export Task” 把该目录打包为 zip/tar（便于分享、审计、复盘）

GUI 只是入口与操作面板，任务目录是最终可复现交付物。
