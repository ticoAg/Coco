# Codex Adapter（Session / Turn / Item）

> 目标：把 Codex CLI 当作一个“后台 coder”，由 AgentMesh 管理其 session，并直接消费 Codex 的结构化事件流生成任务产物。
>
> 不做多 TUI 控制台，不解析 ANSI 屏幕；Codex 的交互用其底层接口完成。

## 1. 接口选项：`codex app-server`

Codex 提供 `codex app-server`（参见 `codex/codex-rs/app-server/README.md`），这是 Codex 用来支撑 VS Code 等富界面的底层接口。

### 1.1 进程与传输

- 启动：`codex app-server`
- 传输：stdio 双向通信
- 格式：逐行 JSON（JSONL）
- 协议：JSON-RPC 2.0 语义，但消息里**省略** `"jsonrpc":"2.0"` 头（见 Codex 文档说明）

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

4) **启动一轮 turn**
- `turn/start { threadId, input: [ { type:"text", text:"..." } ], ...overrides }`
- 一直读取 stdout 的通知事件，直到看到 `turn/completed`

5) **处理审批（人类介入点）**
- Codex 会以 server→client 的 JSON-RPC request 形式发起 approval（例如 applyPatch / execCommand）
- AgentMesh 把它转成 `gate.blocked`，等待用户决定 allow/deny 后再回传响应

### 1.4 事件落盘（说明）

每个 `agent_instance` 通常会落盘：

- `agents/<instance>/runtime/requests.jsonl`：你发给 Codex 的 request（含 id）
- `agents/<instance>/runtime/events.jsonl`：Codex 的 notifications + responses
- `agents/<instance>/runtime/rollout.jsonl`：可选，把 Codex 的 `rolloutPath` 拷贝进任务目录（便于归档与复盘）
- `agents/<instance>/session.json`：持久化 `threadId`、默认 cwd、approval/sandbox 策略等（便于 resume）

> 说明：Codex 自身也会在本地保存 rollout（JSONL）。任务目录里拷贝一份的价值在于“任务闭环可复现”，不依赖用户机器上的 Codex home。

### 1.5 协议 Schema（强类型/兼容性）

Codex app-server 支持生成与当前版本**严格匹配**的 schema（参见 `codex/codex-rs/app-server/README.md`）：

```
codex app-server generate-ts --out DIR
codex app-server generate-json-schema --out DIR
```

adapter 开发时可以把 schema 作为“真源”，避免手写字段导致的版本漂移问题。

## 2. 备选接口：`codex exec --json`

如果你希望“每次运行就是一锤子买卖”并直接拿到 JSONL 事件，可用：

- `codex exec --json -C <cwd> "<PROMPT>"`
- `codex exec resume <SESSION_ID> --json "<PROMPT>"`

事件结构可参考 `codex/codex-rs/exec/src/exec_events.rs`，其中：

- `thread.started.thread_id` 可作为后续 resume 的 session id
- `item.*` 中包含 agentMessage / commandExecution / fileChange / todoList 等

这条路径的特点：

- 优点：实现成本低（子进程 + 读 stdout JSONL）
- 缺点：交互粒度/能力较 `app-server` 弱（例如 approvals、细粒度 delta 等能力以实际版本为准）

## 3. AgentMesh 侧的 adapter 形态（接口示例）

无论采用 `app-server` 还是 `exec --json`，AgentMesh 可以统一对外提供：

- `start_session(agentInstance, cwd, defaults) -> sessionHandle`
- `resume_session(sessionHandle) -> ok`
- `start_turn(sessionHandle, inputText, attachments, overrides) -> stream(events)`
- `interrupt_turn(sessionHandle, turnId) -> ok`
- `respond_approval(callId, decision) -> ok`

其中 `stream(events)` 会被用于：

- 写 `events.jsonl`（原始记录）
- 驱动 `gate.blocked`（审批请求）
- 生成 `artifacts/`（报告、契约、变更摘要）

## 4. 预留：其他 CLI 工具接入

本项目先把 Codex 跑通。未来接入其他 CLI 工具时，接入策略保持一致：

- 接入顺序通常是：先找“底层可编程接口/事件流”（JSON-RPC / JSONL / API）
- 如果某工具只能走 TUI/ANSI 屏幕，再考虑做“录制 + 抽取”的 fallback adapter
