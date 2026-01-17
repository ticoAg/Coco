# Multi/Subagent 执行方案（可信、可复盘、Codex-first）

> 本文是对 AgentMesh 的 multi-agent / subagent 方案的一份“可落地”整合稿：
> - 规划/决策由模型（Orchestrator）负责
> - 执行/并发/落盘/证据链/权限隔离由程序（Controller 状态机 + Adapter）负责
> - GUI 以 artifacts-first 方式读取任务目录呈现结果与介入点
>
> 目标不是“复刻各家 TUI”，而是把协作过程沉淀为可追踪产物（Task Directory），并复用成熟 CLI 工具的底层可编程接口（先做 Codex）。

## 1. 设计目标

- 并发探索：多个 subagent 并行读代码/跑命令/验证假设。
- 并发修改：允许多个 subagent 改不同文件，并在主流程可控合并（建议 worktree 隔离，后续增强）。
- 可信可复盘：每个 subagent 的过程记录与结果落盘，可审计、可复现。
- 主线程上下文可控：主控只吸收“结果索引（路径+摘要+证据引用）”，不吞入巨量日志。
- 人工介入（Human-in-the-loop）：当遇到 approvals 或信息缺口，系统进入 gate.blocked，等待用户输入后再继续。

## 2. 核心抽象（AgentMesh 视角）

- Task
  - 任务的唯一事实来源：`.agentmesh/tasks/<task_id>/`
  - `task.yaml` 表达任务状态、roster、gates、配置。
  - `events.jsonl` 记录 task-level 的 append-only 事件流。
- Agent Instance（subagent/session）
  - 每个 subagent 对应任务目录下的一个实例目录：`agents/<instance>/`
  - 该目录包含 runtime 记录与最终产物（artifacts）。
- Adapter（运行时适配层）
  - 负责对接外部工具（先 Codex），并把其结构化事件写入任务目录。
  - Controller 不解析终端 UI，只消费 JSON/JSONL/RPC 级事件。
- Orchestrator（模型主控）
  - 负责规划与分解：输出结构化 `actions`。
- Controller（程序状态机）
  - 负责执行与并发：解析 actions，spawn/fork subagents，监控完成，join 汇总，处理 gates。

## 3. Codex-first：两条可用执行路径

AgentMesh 对 Codex 的接入建议分两条路径：

### 3.1 `codex exec --json`（适合并行 worker / 低依赖）

特点：一次性运行、stdout 输出 JSONL 事件、实现简单，适合作为 subagent 并行执行的 MVP。

落盘约定（已在 repo 中以 capability 形式固化）：
- `agents/<instance>/runtime/events.jsonl`：stdout JSONL 原样追加
- `agents/<instance>/runtime/stderr.log`：stderr 原样追加
- `agents/<instance>/artifacts/final.json`：最终结构化输出（对齐 `schemas/worker-output.schema.json`）
- `agents/<instance>/session.json`：最小恢复信息（threadId/cwd/codexHome 等）

关键隔离：每个 worker 使用独立 `CODEX_HOME`（默认放到 `agents/<instance>/codex_home/`）。

### 3.2 `codex app-server`（适合原生对话/审批/更细粒度事件）

特点：长期运行进程，stdio 双向 JSON-RPC，具备 thread/turn/item 的会话模型，支持 approvals（server→client 请求）。

它更适合：
- GUI 的 Codex Chat（会话列表、流式 item、内联审批）
- 需要 fork/rollback 的上下文控制
- 需要更细粒度可观测性（turn/started、turn/completed、item/*）

在 AgentMesh 中，`app-server` 既可以服务 GUI，也可以作为 Controller 的 adapter（建议抽成可复用库）。

## 4. Fork vs Spawn（上下文继承策略）

- Spawn（默认、成本低）
  - 把 subagent 当“长耗时工具”调用：只传任务定义 + 输出要求。
  - 子任务上下文自己去 repo 读文件/跑命令，主控不打包大段历史。

- Fork（需要继承上下文时）
  - 当子任务必须继承主线程讨论过的约束/决策（例如架构方向）时，用 fork 派生子会话。
  - 注意：vendor 的 fork/resume 历史可能是 lossy（工具输出不一定完整复现）。因此 fork 模式必须依赖 Task Directory 的 evidence/artifacts 兜底。

- Rollback / Detached（控制主线程污染）
  - 如果“派发任务/打包上下文”的过程不希望进入主会话历史，可用两种手段：
    - detached thread：用专门线程做派发（主线程不承担这些 turns）
    - rollback：派发完成后回退最近 turns（注意：只回滚历史，不回滚文件）

## 5. Controller 状态机（程序）

建议把 Controller 做成事件驱动状态机（可持久化），核心状态：

- `Init`：加载 workspace root、初始化 adapter
- `Planning`：Orchestrator 产出结构化 `actions`
- `Dispatching`：为每个 action 创建 agent instance + 启动 subagent（spawn 或 fork）
- `Monitoring`：监听 runtime 事件与进程状态
- `Joining`：收敛 subagent 的 `final.json` 生成共享报告
- `Blocked`：出现 approvals / 缺少输入 → 进入 gate.blocked，等待用户在 `shared/human-notes.md` 介入
- `Done/Failed`：完成或失败

单个 subagent 的最小状态：`running / completed / failed / blocked / cancelled`。

## 6. Evidence-first：任务空间与证据链

为了让任务可复盘，建议在任务目录中把“证据”作为一等产物：

- 原始记录（runtime）
  - events.jsonl / requests.jsonl / stderr.log
- 结构化结果（artifacts）
  - final.json / patch / report.md 等
- 证据索引（evidence index）
  - `shared/evidence/index.json`：列出 `EvidenceEntry[]`
  - 报告/决策中用 `evidence:<id>` 引用证据，而不是复制大段日志

> 这部分的目录与格式在 OpenSpec change `add-task-evidence-index` 中做了规范化提案。

## 7. Gates / approvals / resume

- 当 subagent 的输出 `status=blocked`，或 adapter 收到 approval request：
  - Controller 把 task state 置为 `input-required`
  - 创建/更新 gate（`gates[].state = blocked`），并在 `events.jsonl` 写入 `gate.blocked`
  - gate 指向 `./shared/human-notes.md` 作为人工介入入口

- 用户介入方式（MVP）：
  - 编辑 `shared/human-notes.md`（补充约束、批准/拒绝、给缺失信息）
  - Controller 检测到更新后 resume：重新派发或继续执行

## 8. GUI（Artifacts-first）如何落地

- GUI 只读任务目录即可提供：
  - 任务列表（按 state/更新时间）
  - 任务详情（Overview/Reports/Contracts/Decisions/Events/Subagents）
  - Subagent sessions：读取 `agents/<instance>/session.json`、`runtime/events.jsonl`、`artifacts/final.json`
  - Artifacts：读取 `shared/reports|contracts|decisions`（缺失视为空）

- 可选增强：Codex Chat
  - 用 `codex app-server` 驱动原生对话与内联审批
  - 补齐 fork/rollback（用于验证 fork 模式与“主线程清理”的交互）

## 9. OpenSpec 变更计划（已 scaffold）

按依赖顺序，建议用以下 changes 推进实现：

1) `add-task-evidence-index`
- 为 Task Directory 增加 evidence 目录与 evidence index（可引用证据）。

2) `add-codex-app-server-adapter`
- 新增 `codex-app-server-adapter` capability：把 app-server 的会话/事件/审批能力纳入 AgentMesh adapter 层，并落盘。

3) `add-orchestrator-controller-loop`
- 新增 `orchestrator-controller-loop` capability：定义 Orchestrator actions 输出与 Controller 状态机闭环。

4) `update-gui-codex-chat-fork-rollback`
- 扩展 `gui-codex-chat`：加入 thread/fork 与 thread/rollback 的 UI/交互，用于验证 fork/rollback 的真实语义与边界。

## 10. 下一步建议

- 先实现 Phase 1（Controller + codex exec 并行 worker + join + gates），把“产物驱动闭环”跑通。
- 再接入 app-server adapter，把 approvals 与 fork/rollback 作为增强能力逐步落地。
- 并行推进 GUI 的 artifacts-first 展示（只读任务目录），让用户可以随时介入与复盘。
