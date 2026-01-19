# 子代理（Subagents）落地方案：以 Codex CLI 为例

> 目标：用 **Codex CLI** 跑多个并行 worker（分工 + 独立上下文 + 可恢复 + 状态可视化），并把过程/结果落盘到任务目录（Task Directory）。
>
> 本文聚焦 **`codex exec --json + prompt`** 这条可行实现路径：Coco 负责控制面（并发、状态、产物、人工介入）；Codex CLI 作为一个或多个后台 worker 运行。

> 注：这里的“coco 控制面”可以内置在 GUI/Tauri 后端运行；`coco` CLI 仅作为可选 wrapper，并非必须入口。
>
> 执行闭环（Task Directory + Workers + Gates / Evidence-first）见：[`docs/coco/execution.md`](./execution.md)。本文主要聚焦并行 worker（`codex exec --json`）这条路径如何落地。

## 1. 关键诉求与结论

你想要的能力可以拆成 4 个必须件：

1) **主控能拆解任务并派发多个子任务并行执行**（<= 8）
2) **每个子任务有独立上下文**（避免主会话污染、避免不同子任务互相干扰）
3) **主控实时感知每个子任务的状态**（Running/Completed/Failed/Blocked），并且“任意一个完成就立刻通知”
4) **能汇总结果并进入下一轮决策**（继续拆分/等待其他/合并产物/人工介入）

在 Codex 生态里，落地的最小闭环是：

- **每个 subagent = 一个独立 `codex exec --json` 进程**
- Coco **解析 JSONL 事件流**来驱动状态与 GUI
- 为每个 subagent 分配独立 **`CODEX_HOME`**，保证“上下文/会话/缓存”隔离（强烈建议）
- 通过 `--output-schema` 强制 subagent **最终输出结构化 JSON**，便于 join/汇总与后续编排
- `codex` 可执行文件 **仅依赖 PATH**（不随 Coco 打包）

> 注：`codex app-server` 也可做（能力更强、支持 approvals 交互），但“并行 subagent + GUI 状态”这个阶段，`codex exec --json` 更轻、更快落地。

## 2. 架构：GUI + Controller + Workers（subagents）

```
┌──────────────────────┐
│      Coco GUI   │  只读：任务拓扑 / subagent 列表 / 状态 / 输出与产物
└──────────┬───────────┘
           │ 读取任务目录（文件系统 watcher/轮询）
┌──────────▼───────────┐
│   Task Directory      │  事实来源：task.yaml + events.jsonl + agents/*/runtime/*
└──────────┬───────────┘
           │ coco 控制面（内置后端 / 可选 CLI）
┌──────────▼───────────┐
│ Controller (coco-orchestrator) │  spawn/resume/cancel/join/落盘（启动后台 worker 后即可退出）
└──────────┬───────────┘
           │ spawn N 个进程（<= 8）
┌──────────▼───────────┐
│  codex exec --json    │  subagent-1（独立 CODEX_HOME；可选 worktree）
├──────────────────────┤
│  codex exec --json    │  subagent-2（独立 CODEX_HOME；可选 worktree）
├──────────────────────┤
│  codex exec --json    │  subagent-3（…）
└──────────────────────┘
```

Task Directory 是事实来源：

- Controller（内置后端或可选 CLI wrapper）负责创建/更新任务目录（spawn/resume/cancel/join）
- 每个 worker 直接把 JSONL 事件写入 `agents/<id>/runtime/events.jsonl`（stdout 重定向）
- worker 的最终结构化输出写入 `agents/<id>/artifacts/final.json`
- GUI 只需读取目录并渲染（不需要常驻后端服务）

GUI 只是把这些事实呈现出来并提供“人工介入动作”（允许/拒绝/补充约束/重跑/合并）。

> 术语提醒：Controller 是程序状态机；Orchestrator（模型）是规划层（输出结构化 actions）。两者职责分离能显著降低上下文污染并提升可复盘性。

## 3. subagent 的“独立上下文”如何实现

为了让每个 worker 具备“独立上下文”的效果，Codex 侧可以用两层隔离实现：

### 3.1 独立会话与状态隔离：独立 `CODEX_HOME`

每个 subagent 启动时设定：

- `CODEX_HOME=<task_dir>/agents/<id>/codex_home`（或 `.coco/registry/codex_home/...`）

这样 Codex 自己的 sessions/rollouts/config cache 互不影响，达到“上下文隔离”的核心目标。

### 3.2 并发写冲突隔离：两种写入策略

你提出的约束是：**worktree 作为可选项**；未启用 worktree 时，**同一时间只允许一个可写会话**，其他会话可以并行只读。

建议把“写入策略”显式建模为 `workspaceMode`（示意）：

- `worktree`：每个 subagent 独立 worktree + branch，可并行写（推荐）
- `shared`：不创建 worktree；允许多个只读 subagent 并行，但 **write-enabled subagent 必须串行**（由 Controller 通过 lock 保证）

#### 3.2.1 `worktree`（并发写：推荐）

每个 subagent 在独立 worktree 执行：

- `cwd=<repo>/.coco/worktrees/<task_id>/<agent_id>`
- `branch=coco/<task_id>/<agent_id>`

冲突集中在合并阶段（可视化、可回滚、可人工介入），而不是执行阶段“互相覆盖”。

#### 3.2.2 `shared`（单写多读：你的偏好）

在共享工作目录模式下：

- 所有 worker 共享同一个 `cwd=<repo>`
- Controller 维护一个 **写锁**（例如 `.coco/locks/workspace-write.lock`）
  - 只有拿到写锁的 worker 才允许写入/修改文件
  - 其他 worker 只做“读 + 分析 + 报告”，不做文件变更

> 备注：read-only 的“强制性”可以分阶段实现：MVP 用 prompt + 变更检测（diff 为空则通过）；增强版在 macOS 上用 `sandbox-exec`/文件权限约束实现真正只读。

## 4. 状态感知：用 `codex exec --json` 的事件流驱动 UI

### 4.1 事件来源

`codex exec --json` 会在 stdout 输出 JSON Lines（每行一个 event）。事件定义见 Codex 源码：

- `github:openai/codex/codex-rs/exec/src/exec_events.rs`

常用事件（示意）：

- `thread.started`：提供 `thread_id`（用于后续 resume）
- `turn.started` / `turn.completed` / `turn.failed`
- `item.started` / `item.updated` / `item.completed`，其中 item 类型包含：
  - `command_execution`（命令/输出/exit code）
  - `file_change`（变更文件列表）
  - `todo_list`（计划步骤与状态）
  - `agent_message` / `reasoning` / `error`

### 4.2 subagent 状态机（Controller 内部）

建议最小状态：

- `queued`：等待执行
- `running`：收到 `turn.started` 后进入
- `blocked`：需要人类输入/审批（MVP 可先用“worker 输出 status=blocked”表达；后续用 app-server 处理 approvals）
- `completed`：收到 `turn.completed` 且 worker 正常退出
- `failed`：收到 `turn.failed` 或进程异常退出
- `cancelled`：用户主动取消（SIGINT/SIGTERM）

### 4.3 “完成即通知主控”：文件 watcher + `wait_any`（CLI）

在“短进程控制面 + 任务目录事实来源”的架构下，`wait_any` 不一定需要常驻服务：

- GUI 可以对 `agents/*/runtime/events.jsonl` 做文件监听：任意一个进入 terminal 就 toast
- 主控（你的主 Codex TUI）也可以调用 `coco --json subagent wait-any <taskId>`：
  - 其本质是“阻塞等待某个 worker 的 events/final.json 变化”，检测到 terminal 状态即返回 `{agentInstance, status}`

实现上可以用：

- 子进程退出（`exit`）作为强信号
- 或监听事件流里 `turn.completed/turn.failed` 作为弱信号（仍要等进程退出做收尾）

## 5. 让输出可编排：强制结构化最终输出（JSON Schema）

如果 subagent 的最终输出只是自然语言，join 会很难自动化。

建议对每个 subagent 强制 `--output-schema`，让它最后输出一个 JSON 对象（stdout JSONL 里会体现为 agent_message 的文本是 JSON 字符串，或通过 `--output-last-message` 落盘）。

推荐 schema：[`schemas/worker-output.schema.json`](../../schemas/worker-output.schema.json)（由 Coco 定义）。

核心字段建议：

- `status`: `"success" | "blocked" | "failed"`
- `summary`: 1-3 句总结（人类看）
- `artifacts`: 产物指针（branch/worktree/diff/files）
- `questions`: 需要主控/用户回答的问题（用于 unblock）
- `next_actions`: 主控下一步建议（继续拆分/验证/合并）

## 6. 最小可跑命令（建议）

以每个 subagent 为例（示意）：

```
CODEX_HOME="<task>/agents/<id>/codex_home" \
codex exec --json \
  -C "<worktree_path>" \
  --output-schema "<repo>/schemas/worker-output.schema.json" \
  --output-last-message "<task>/agents/<id>/artifacts/final.json" \
  "<PROMPT>"
```

你也可以把 prompt 从 stdin 喂给 `codex exec`，避免命令行过长。

## 7. 何时切换到 `codex app-server`

当你需要“真正意义的 interactive approvals（命令/patch 的 allow/deny）”且希望 GUI 对每个 approval 做细粒度呈现时，建议切换到：

- `codex app-server`（stdio JSON-RPC + notifications）

它更像“后端服务”，天然适合 GUI 驱动；复杂度更高，但一旦你需要“原生对话 + 内联审批 + 流式 item 事件”，就值得提前使用（例如 GUI 的 **Codex Chat** 视图）。

> 说明：对“并行 subagents/worker + 任务产物落盘”这个阶段，`codex exec --json` 仍然更轻、更容易并发隔离；是否统一切换到 app-server 可以按需求分阶段演进。

## 8. Orchestrator 最小实现要点（给你写 Coco 用）

这一节把“可行方案”进一步落到工程颗粒度，方便你在 `Coco` 项目里直接开干。

### 8.1 子进程管理（spawn / cancel / 收尾）

每个 worker 进程建议具备：

- `pid`
- `startedAt/endedAt`
- `stdout`（JSONL reader）
- `stderr`（原样落盘，便于排障）

取消建议策略：

1) 先发送 SIGINT（让 Codex 尝试优雅中断）
2) 等待一个短超时（例如 2-5s）
3) 仍未退出则 SIGTERM/SIGKILL（按平台选择）

### 8.2 状态聚合：只需要处理少量事件类型

MVP 里你不必消费所有事件字段；只要能做下面这几类展示就够了：

- `thread.started.thread_id`：保存为 `session_id`（用于 resume）
- `turn.started/turn.completed/turn.failed`：驱动 worker 状态
- `item.*`：
  - `command_execution`：显示“正在跑什么 + 最近输出”
  - `file_change`：显示“改了哪些文件”
  - `todo_list`：显示“计划到哪一步”

### 8.3 任务目录落盘（推荐与 `artifacts.md` 对齐）

建议每个 worker 在任务目录有固定落点：

- `<task_dir>/agents/<agent_id>/runtime/events.jsonl`：原始 JSONL（stdout）
- `<task_dir>/agents/<agent_id>/runtime/stderr.log`：stderr 原样落盘
- `<task_dir>/agents/<agent_id>/artifacts/final.json`：`--output-last-message` 的结果（结构化）
- `<task_dir>/agents/<agent_id>/session.json`：记录
  - `threadId`（用于 resume；本质是 Codex session/thread 的 UUID 字符串）
  - `worktreePath` / `branch`（如启用 worktree）
  - `codexHome`

最终再由 Controller 把多个 worker 的 `final.json` join 成：

- `<task_dir>/shared/reports/joined-summary.md`（人类入口）
- `<task_dir>/shared/reports/joined-summary.json`（机器入口，可选）

并建议同时维护 Evidence Index：
- `<task_dir>/shared/evidence/index.json`（EvidenceEntry[]，报告中用 `evidence:<id>` 引用关键证据）

### 8.4 最小接口（给 GUI/主控用）：接口 + 文件（CLI 可选）

在你选择的形态里，GUI 只读任务目录，所以它**不需要**依赖一个常驻的 HTTP 服务。

控制面建议提供一层可编程接口；如需脚本化，可用 `coco` CLI 作为可选 wrapper（短进程）。命令集合示意：

- `coco subagent spawn <taskId> --instance <agentInstance> --agent <agent> "<PROMPT>"`：启动一个 subagent
- `coco --json subagent list <taskId>`：列出全部 subagents 状态
- `coco --json subagent wait-any <taskId> [--timeout-seconds N]`：阻塞直到任意完成（或超时）
- `coco subagent cancel <taskId> <agentInstance>`：取消
- `tail -f .coco/tasks/<taskId>/agents/<agentInstance>/runtime/events.jsonl`：跟随输出 events（MVP 可先用文件 tail；`tail-events` 子命令可后续补齐）

GUI 展示的事实来源仍然是文件：

- `task.yaml` / `events.jsonl`
- `agents/<id>/runtime/events.jsonl`
- `agents/<id>/artifacts/final.json`

GUI 实时刷新可以用两层：

- 轻量：任务目录文件 watcher/轮询（task.yaml + 最新 events ts）
- 深入：用户点进某个 subagent 时再 tail `agents/<id>/runtime/events.jsonl`

### 8.5 resume（恢复子代理会话）

当用户在 GUI 中点击 Resume（或主控需要追加问题）时：

- 读取 `session.json` 里的 `threadId`
- 调用：`codex exec resume <threadId> --json -C <worktree> "<PROMPT>"`

> 备注：`codex exec resume` 也支持不指定 id 并用 `--last` 选择最近会话；是否采用取决于你是否希望“显式可复盘”（通常建议显式记录并使用 `threadId`）。

> 注意：resume 的可用性依赖 Codex 对 session 的落盘策略；因此强烈建议 per-worker 独立 `CODEX_HOME`，避免 session 文件互相覆盖或被清理。
