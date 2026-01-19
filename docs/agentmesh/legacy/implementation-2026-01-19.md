# AgentMesh 实现评估（Codex-first / Session-based）

> 注意：本文为 2026-01-19 从 `docs/agentmesh/implementation.md` 迁移的历史备份，可能与当前主线文档不一致。
>
> 当前主线入口：
> - 执行闭环：[`docs/agentmesh/execution.md`](../execution.md)
> - 实现评估（主线）：[`docs/agentmesh/implementation.md`](../implementation.md)

> 目标：参考 `docs/references/` 下的文档，评估如何落地 [[AgentMesh.md]](../../AgentMesh.md) 的设计，并把**可让用户随时介入与修正**的产物形态作为首要产出。
>
> 重要前提：本项目核心是**直接复用各方成熟的 code TUI/CLI 产品**（例如 codex cli 这类交互式命令行）。A2A / ACP / Claude Code Subagents 的概念只用于借鉴交互模型与术语，不作为硬依赖或必做集成。

> 当时的 multi/subagent 整合稿见：[`docs/agentmesh/legacy/multiagent-2026-01-19.md`](./multiagent-2026-01-19.md)。
>
> 术语约定（避免歧义）：
> - **Orchestrator（模型）**：负责规划/分解/验收，输出结构化 actions。
> - **Controller（程序）**：负责状态机执行/并发调度/落盘/证据链/权限隔离（仓库代码里通常落在 `agentmesh-orchestrator` crate）。

## 1. 设计要点回顾（从 AgentMesh 设计抽象成工程需求）

从 [[AgentMesh.md]](../../AgentMesh.md) 与 [[README.md]](../../README.md) 可抽象出以下“必须能落地”的能力：

1) **多拓扑协作**
- `Swarm`：并发 `fork/join`（诊断/搜集/并行实现）
- `Squad`：分层小队 + 里程碑 gating（架构师主导、FE/BE/QA 协作）

2) **生命周期与降噪**
- `Active` / `Awaiting`（待命沉默）/ `Dormant`（可恢复休眠）
- 支持 `@Agent` 唤醒、完成后自动沉默、完成后触发下游 agent（hooks）

3) **显式共享，避免上下文广播**
- `Global / Task / Private` 三层作用域
- 共享必须通过“显式附加（explicit attach）”完成（文件/片段/契约），而非把整个上下文倾倒给别的 agent

4) **结构化交换 + 可追踪产物**
- Agent 输出以结构化报告为主（如 `DiagnosticReport`、测试报告、API Contract）
- 每个任务落盘为 `Task Directory`，产物带元数据，可引用/可检索/可回溯

> 工程结论：要实现上述目标，核心不是“多模型推理”，而是**控制面（编排、状态机、权限、产物）**与**数据面（各 vendor agent 的适配执行）**的解耦。

## 2. 参考资料怎么用（只借思路，不绑定实现）

### 2.1 Claude Code Subagents（仅参考其“分工 + 上下文隔离”思路）

`docs/references/code.claude.com/sub-agents.md` 里 Subagents 的价值点是：

- 把复杂任务拆给“专门角色”，减少主线程上下文污染
- 每个角色有独立上下文与工具权限边界
- 有可恢复的会话概念（resume）

**但**本项目不计划直接复用 Claude Code 的 Subagents 技术实现（例如 `.claude/agents/*.md`、`/agents`、`resume agentId` 等）。在 AgentMesh 中：

- 我们把每个 agent 当作一个**独立运行时**（CLI 工具），通过其“底层可编程接口/事件流”（例如 Codex app-server/exec）来管理 session 与提取输出
- “上下文隔离”由“多进程/多会话 + 任务目录产物 + 显式共享”实现，而不是依赖某家产品的 subagent 功能

### 2.2 Skills（固定定义：按 `docs/references/skills/README.md`）

Skills 在本项目里视为各家 agent 可共享的一种**能力封装形式**（指令、脚本、资源）。我们遵循 `docs/references/skills/README.md` 的原始定义：

- 一个 skill 是一个**自包含文件夹**，其中包含 `SKILL.md`（YAML frontmatter + 指令正文）
- frontmatter 的关键字段是 `name` 与 `description`

`docs/references/openai-codex/skills.md` 仅说明 codex 作为某个运行时如何“消费 skills”，不应被当作 Skills 的规范扩展。

在 AgentMesh 中，Skills 的职责边界应保持克制：

- AgentMesh 负责：**skills 资产的管理与分发**、以及“给哪个 agent 预装哪些 skill sets”的配置
- 各 TUI/CLI 产品如何加载 skills（插件机制、目录约定、prompt 指引、脚本调用等）由对应的 **adapter** 负责

### 2.3 Agent2Agent（仅参考其“Task / Artifact / input-required”语义）

`docs/references/A2A/topics/*` 提供了一个很清晰的语言：Task 生命周期、Artifact 交付、`input-required`（需要人类补充）。

在 AgentMesh 中，这些概念可作为**术语与建模参考**：

- `Task` → `.agentmesh/tasks/<task_id>/`
- `Artifact` → 任务目录中的可交付文件（报告/契约/变更集/rollout/事件记录等）
- `input-required` → `gate.blocked`（等待用户在 `human-notes.md` 或 UI 中介入）

但本项目核心不要求实现 A2A 的 server/client 或网络互通。

### 2.4 Agent Client Protocol（仅参考其“编辑器交互”分层）

`docs/references/agentclientprotocol/introduction.md` 描述了 IDE ↔ agent 的协议化交互。

在 AgentMesh 中，ACP 仅作为参考：本项目先把“CLI 工具 session 化 + 结构化产物 + 人工介入”打通，是否提供 ACP 兼容层属于后置增强，而不是核心路径。

## 3. Codex-first：把“coder session”落到可编程的 Session/Thread

你明确不想做“多 TUI 控制台”，而是希望**把 CLI 工具放在后台维护**，并通过“底层 API”直接读出结构化输出。

以 Codex 为例（本仓库已包含 `./codex` 源码可参考），Codex CLI 提供了两条适合做 adapter 的路径：

### 3.1 `codex app-server`（面向富 UI/自动化的底层接口）

Codex 自带 `codex app-server`（参见 `github:openai/codex/codex-rs/app-server/README.md`）：

- 传输：stdio 双向通信，JSON-RPC 2.0（按行 JSONL 流式）
- 基元：`Thread`（会话）/ `Turn`（一轮输入到输出）/ `Item`（过程中产生的消息、命令、文件变更等）
- 优点：事件细粒度、可中断、可处理 approvals（审批请求是 server→client 的 RPC）

对 AgentMesh 来说，它天然对应：

- **coder session** → Codex `threadId`
- **一次协作回合** → Codex `turn/start` 到 `turn/completed`
- **结构化交换** → `item/*`（agentMessage、command、fileChange 等）
- **人工介入/gating** → approvals / interrupt（把“是否允许执行”提升为一等事件）

### 3.2 `codex exec --json`（备选：一次性跑完一轮并输出 JSONL 事件）

Codex 也提供 `codex exec`（参见 `github:openai/codex/codex-rs/exec/`）：

- `--json`：stdout 输出 JSONL 事件（事件结构见 `github:openai/codex/codex-rs/exec/src/exec_events.rs`）
- 输出里包含 `thread.started` 的 `thread_id`，可用于后续 `resume`

这条路径的特点是：实现简单、无需长期后台服务，但“会话/turn”能力相对 `app-server` 更弱一些（更像一次性执行器）。

对 AgentMesh 来说，它非常适合作为 **子代理（subagents）并发执行** 的 MVP：

- 每个 subagent = 独立 `codex exec --json` 子进程（<=8）
- Controller/GUI 只需解析 stdout 的 JSONL 事件，就能驱动实时状态
- 配合独立 `CODEX_HOME` + git worktree，可获得“独立上下文 + 并发隔离”的体验

细节见：[`docs/agentmesh/subagents.md`](./subagents.md) 与 [`docs/agentmesh/adapters/codex.md`](./adapters/codex.md)。

Codex adapter 的具体交互与落盘细节见：[`docs/agentmesh/adapters/codex.md`](./adapters/codex.md)。

## 4. 总体架构（Session 驱动 + 产物驱动）

不做多 TUI 控制台时，AgentMesh 实际管理的是“一组 coder sessions”，核心是：**如何创建/恢复 session、如何跑一轮 turn、如何把事件流写入任务目录并生成产物**。

### 4.1 分层：控制面 / Adapter（Codex）/ 产物面

- **控制面（Controller 状态机）**
  - 任务状态机（拓扑、里程碑、fork/join、hooks）
  - 人工介入（gates：批准/拒绝/补充）
  - 产物汇总（join：把多个 agent 的结果合并为最终报告/下一步）
- **规划层（Orchestrator 模型）**
  - 产出结构化 `actions`（controller 解析执行）
  - 只吸收“结果索引（路径+摘要+evidence 引用）”，避免吞入全量过程日志
- **Adapter（Codex-first）**
  - 启动并维护 Codex 后台进程（例如 `codex app-server`）
  - 对外提供 session/turn 抽象：`start_session` / `resume_session` / `start_turn` / `interrupt_turn` / `approve_or_deny`
  - 把 Codex 的事件流落盘（JSONL），并提取关键内容生成 AgentMesh 产物
- **产物面（Task Directory）**
  - 任务目录是事实来源：报告、契约、决策、gates、以及原始事件记录
  - 让用户能直接编辑产物，影响下一轮 turn（human-notes / context-manifest）

### 4.2 Adapter 的现实定位：事件收集器 + 结构化提取器

对 Codex 这种提供底层事件流的工具，adapter 的关键不是“解析终端渲染”，而是：

- **事件收集**：把 `turn/started`、`item/*`、`turn/completed`（或 exec 的 `ThreadEvent`）完整记录下来
- **结构化提取**：从 items/events 中提取
  - 最终答复（agentMessage）
  - 命令与输出（commandExecution）
  - 文件变更列表（fileChange）
  - TODO（todoList）与错误（error）
- **审批对齐**：把 Codex 的审批请求映射为 AgentMesh 的 `gate.blocked`，等待用户决策后再回传 allow/deny

## 5. 哪些点“今天就能做”，哪些点需要分阶段（Codex-first）

### 可以立刻实现（产物驱动，低依赖）

- 固化 Task Directory 规范（见 [[artifacts.md]](./artifacts.md)）
- 固化结构化报告模板（`DiagnosticReport` / Test Report / API Contract）
- 固化 Evidence Index（`shared/evidence/index.json`）与“报告引用 token”（`evidence:<id>`），让主控不依赖对话历史也能复盘（见 `openspec/changes/add-task-evidence-index/`）
- 固化“显式共享”流程（用 manifest 指定 attach 的文件/片段）
- 用你现有的 `agents/*/agents.md` 作为“可复用 Agent Spec 模板库”

### 需要阶段性投入的点（Codex adapter 与 session 对齐）

- **Codex 事件到 AgentMesh 产物的映射**：哪些事件写 `events.jsonl`，哪些提取为 `reports/*.md`
- **审批/gates**：如何把 Codex 的 approval request 映射为 `gate.blocked`，并把人类决策安全回传
- **会话恢复**：`threadId`/rollout 的持久化与 resume；以及 `Dormant` 时用“摘要 + 产物”重新驱动下一轮
- **Skills 装配**：Skills 的规范固定，但各运行时启用方式不同；adapter 需要把选定 skill set 以 Codex 可用方式提供
- **其他工具预留**：当其他 CLI 没有 app-server/exec JSON 事件流时，才考虑 fallback（例如 PTY 录制/抽取）；但这不是 Codex-first 的首要难点

## 6. 下一步：从“产物形态”开始（你要的“任何环节可人工介入”）

相关内容见：

- [[artifacts.md]](./artifacts.md)：如何定义任务目录、报告、契约与人工介入点
- [[roadmap.md]](./roadmap.md)：如何分阶段实现“Codex adapter + 事件流提取 + 产物落盘”
