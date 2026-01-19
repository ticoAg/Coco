# Codex Adapter（Session / Turn / Item）

> 目标：把 Codex CLI 当作一个“后台 coder”，由 AgentMesh 管理其 session，并直接消费 Codex 的结构化事件流生成任务产物。
>
> 不做多 TUI 控制台，不解析 ANSI 屏幕；Codex 的交互用其底层接口完成。

> 执行闭环（Task Directory + Workers + Gates / Evidence-first）见：[`docs/agentmesh/execution.md`](../execution.md)。

## 1. 接口选项：`codex app-server`

Codex 提供 `codex app-server`（参见 `github:openai/codex/codex-rs/app-server/README.md`），这是 Codex 用来支撑 VS Code 等富界面的底层接口。

### 1.1 进程与传输

- 启动：`codex app-server`
- 传输：stdio 双向通信
- 格式：逐行 JSON（JSONL）
- 协议：JSON-RPC 2.0 语义，但消息里**省略** `"jsonrpc":"2.0"` 头（见 Codex 文档说明）
- 本地状态：可以复用用户的 Codex Home（通常为 `~/.codex/`，包括 `~/.codex/sessions` 与 `~/.codex/config.toml`），也可以为每个 agent instance 设置独立 `CODEX_HOME` 做隔离（推荐用于 subagents / 并行任务）。

> 建议：
> - **Codex Chat（GUI 原生对话）** 可以复用用户 `~/.codex/`，获得“会话历史/配置”一致性。
> - **AgentMesh subagents/任务执行** 建议 per-agent `CODEX_HOME = agents/<instance>/codex_home/`，避免会话与缓存互相污染，且利于任务可迁移归档。

### 1.2 核心对象映射

- Codex `Thread` ≈ AgentMesh 的 **coder session**
- Codex `Turn` ≈ “一轮输入→输出”的工作回合
- Codex `Item` ≈ 过程事件与产物片段（用户消息、agentMessage、命令、文件变更、reasoning 等）

### 1.3 最小工作流（示例）

1) **启动 app-server 进程（后台）**
- Orchestrator 启动并持有该进程的 stdin/stdout

2) **初始化握手**
- `initialize`（request）
- `initialized`（notification）

3) **创建/恢复 session**
- `thread/start`（新会话，返回 `thread.id`）
- 或 `thread/resume`（已存在的 `threadId`）
- （可选）`thread/fork`（从既有 thread 派生新 thread；用于 fork 继承上下文）
- （可选）`thread/rollback`（回退最近 N 个 turns 的历史；仅回滚历史，不回滚文件）

4) **启动一轮 turn**
- `turn/start { threadId, input: [ { type:"text", text:"..." } ], ...overrides }`
- 一直读取 stdout 的通知事件，直到看到 `turn/completed`

5) **处理审批（人类介入点）**
- Codex 会以 server→client 的 JSON-RPC request 形式发起 approval（例如 applyPatch / execCommand）
- AgentMesh 把它转成 `gate.blocked`，等待用户决定 allow/deny 后再回传响应

> 实践建议：如果你在 GUI 内提供 “Codex Chat”（原生对话）视图，审批也可以直接作为会话消息渲染「批准/拒绝」按钮回传给 app-server；是否还需要映射为 `gate.blocked`，取决于你是否把该对话纳入 AgentMesh 的任务编排与产物体系。

### 1.4 事件落盘（说明）

每个 `agent_instance` 通常会落盘：

- `agents/<instance>/runtime/requests.jsonl`：client→server 的 JSON-RPC 消息（requests / notifications / responses）
- `agents/<instance>/runtime/events.jsonl`：server→client 的 JSON-RPC 消息（responses / notifications / requests；含 approvals 请求）
- `agents/<instance>/runtime/rollout.jsonl`：可选，把 Codex 的 `rolloutPath` 拷贝进任务目录（便于归档与复盘）
- `agents/<instance>/session.json`：持久化 `threadId`、默认 cwd、approval/sandbox 策略等（便于 resume）
- `shared/evidence/index.json`：建议由 Controller 汇总维护的 Evidence Index（报告/决策用 `evidence:<id>` 引用）

实现参考：
- app-server client（spawn + stdio JSONL loop + recording）：`crates/agentmesh-codex/src/app_server_client.rs`
- orchestrator wrapper（semantic API：start/resume/fork/rollback/turn/...）：`crates/agentmesh-orchestrator/src/codex_app_server_adapter.rs`

> 说明：Codex 自身也会在本地保存 rollout（JSONL）。任务目录里拷贝一份的价值在于“任务闭环可复现”，不依赖用户机器上的 Codex home。

### 1.5 协议 Schema（强类型/兼容性）

Codex app-server 支持生成与当前版本**严格匹配**的 schema（参见 `github:openai/codex/codex-rs/app-server/README.md`）：

```
codex app-server generate-ts --out DIR
codex app-server generate-json-schema --out DIR
```

adapter 开发时可以把 schema 作为“真源”，避免手写字段导致的版本漂移问题。

## 2. 备选接口：`codex exec --json`

如果你希望“每次运行就是一锤子买卖”并直接拿到 JSONL 事件，可用：

- `codex exec --json -C <cwd> "<PROMPT>"`
- `codex exec resume <SESSION_ID> --json "<PROMPT>"`

事件结构可参考 `github:openai/codex/codex-rs/exec/src/exec_events.rs`，其中：

- `thread.started.thread_id` 可作为后续 resume 的 session id
- `item.*` 中包含 agentMessage / commandExecution / fileChange / todoList 等

这条路径的特点：

- 优点：实现成本低（子进程 + 读 stdout JSONL）
- 缺点：交互粒度/能力较 `app-server` 弱（例如 approvals、细粒度 delta 等能力以实际版本为准）

### 2.1 subagent 并发执行的推荐用法（AgentMesh MVP）

当 AgentMesh 需要并行跑多个 subagent（<=8）并在 GUI 中实时展示状态时，`codex exec --json` 是最省事的一条路：

- 每个 subagent = 一个独立的 `codex exec --json` 子进程
- worker stdout 只输出 JSONL：建议直接重定向落盘到 `agents/<id>/runtime/events.jsonl`，GUI/主控通过读文件实时展示状态
- `codex` 可执行文件仅依赖 PATH（AgentMesh 不负责分发/嵌入）

#### 2.1.1 强烈建议：每个 subagent 独立 `CODEX_HOME`

为了做到“上下文/会话/缓存隔离”，建议为每个 subagent 指定独立 `CODEX_HOME`，例如：

- `<task_dir>/agents/<agent_id>/codex_home/`

这会让 Codex 的 sessions/rollouts 等文件互不干扰，更接近“每个 worker 有独立上下文”的体验。

#### 2.1.2 worktree（可选，但推荐用于并发写）

为了避免并发写同一份文件导致运行时冲突，启用 worktree 时每个 subagent 在独立 worktree 跑：

- `<repo>/.agentmesh/worktrees/<task_id>/<agent_id>/`
- 分支名：`agentmesh/<task_id>/<agent_id>`

这样冲突集中在合并阶段（可视化、可回滚），而不是执行阶段“互相覆盖”。

如果你选择不启用 worktree（共享工作目录）：

- 允许多个“只读” subagent 并行（做分析/报告）
- 但 **write-enabled subagent 必须串行**（用写锁保证）

#### 2.1.3 建议命令（示意）

```
CODEX_HOME="<task_dir>/agents/<agent_id>/codex_home" \
codex exec --json \
  -C "<cwd>" \
  --output-schema "<repo>/schemas/worker-output.schema.json" \
  --output-last-message "<task_dir>/agents/<agent_id>/artifacts/final.json" \
  "<PROMPT>"
```

说明：

- `--json`：stdout 只输出 JSONL 事件；其他信息在 stderr（便于“只读 stdout”）
- `--output-schema`：强制最终输出为结构化 JSON（便于 join/汇总）
- `--output-last-message`：把最终消息直接落盘，GUI/Orchestrator 无需从 JSONL 中二次抽取（可选但推荐）
- `-C "<cwd>"`：启用 worktree 时取 worktree 目录；未启用时取 repo 根目录

#### 2.1.4 如何从事件流推导状态（建议）

- `thread.started`：记录 `thread_id`（可用于 resume/追踪）
- `turn.started`：状态 → `running`
- `turn.completed`：状态 → `completed`（并记录 token usage）
- `turn.failed` 或进程退出码非 0：状态 → `failed`
- `item.*`：
  - `command_execution`：可用于 GUI 展示“正在跑什么命令/输出”
  - `file_change`：可用于展示“改了哪些文件”
  - `todo_list`：可用于展示“计划执行到哪一步”

## 3. AgentMesh 侧的 adapter 形态（接口示例）

无论采用 `app-server` 还是 `exec --json`，AgentMesh 可以统一对外提供：

- `start_session(agentInstance, cwd, defaults) -> sessionHandle`
- `resume_session(sessionHandle) -> ok`
- `fork_session(sessionHandle) -> sessionHandle`（可选；需要 vendor 支持）
- `rollback_session(sessionHandle, numTurns) -> ok`（可选；注意不回滚文件修改）
- `start_turn(sessionHandle, inputText, attachments, overrides) -> stream(events)`
- `interrupt_turn(sessionHandle, turnId) -> ok`
- `respond_approval(callId, decision) -> ok`

其中 `stream(events)` 会被用于：

- 写 `events.jsonl`（原始记录）
- 驱动 `gate.blocked`（审批请求）
- 生成 `artifacts/`（报告、契约、变更摘要）

## 4. 范围说明

本文档只覆盖 Codex 运行时的接入与落盘映射。
