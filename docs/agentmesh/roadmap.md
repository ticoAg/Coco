# AgentMesh 多阶段实施路线图（Codex-first / Session-based）

> 原则：先把“产物形态 + 人工介入点”做扎实；执行层以 **CLI 工具的底层可编程接口** 作为首个接入路径（先做 Codex），直接读取结构化输出。
>
> A2A / ACP / Claude Code Subagents 仅用于参考概念，不作为本项目核心依赖。

## Phase 0（现在）：设计沉淀 + 模板库

**目标**
- 明确协作拓扑、状态机、产物规范
- 提供可复用的 `Agent Spec` 模板（本仓库 `agents/*/agents.md` 已具备雏形）

**交付物**
- `.agentmesh/` 的目录约定（见 `docs/agentmesh/artifacts.md`）
- `DiagnosticReport` / `API Contract` / `Test Report` 模板
- 基础 roster（Architect/FE/BE/QA + DB/Log/Network）

**用户介入**
- 直接编辑 agent spec 模板与报告模板

## Phase 1：本地编排器（产物驱动、可暂停/可恢复、可并发）

**目标**
- 实现一个最小 Orchestrator（CLI/daemon 均可），只要能：
  - 创建 task 目录
  - 执行 `fork/join`（并发跑 N 个 agent）
  - 写入结构化产物 + `events.jsonl`
  - 在 `gate.blocked` 时停下等待人工输入

**实现方式（不绑定 vendor，示例）**
- 先定义一个 **Adapter 接口**：
  - `start(task, agentSpec, prompt, attachments) -> sessionHandle`
  - `poll(sessionHandle) -> status/artifacts`
  - `resume(sessionHandle, message, attachments)`
  - `stop(sessionHandle)`
- 先实现“本地 stub adapter”（用脚本模拟 agent 输出），把编排与产物跑通

**用户介入**
- 编辑 `.agentmesh/tasks/<id>/shared/human-notes.md` 注入纠错
- 编辑 `task.yaml`（改拓扑/改 roster/改 gating）
- 驳回某个 artifact：写入 human-notes 并触发重跑

## Phase 2：Codex Adapter（后台维护 session + 读取结构化事件）

**目标**
- 先把 Codex 做成可用的 adapter：管理一个个 coder session，并从底层事件流直接提取输出
- 不做 TUI 控制台，不解析 ANSI 屏幕；只处理 JSON/JSONL 级别的事件与结果

**实现方式（示例）**
- `codex app-server`（参考 `codex/codex-rs/app-server/README.md`）：
  - stdio JSON-RPC，Thread/Turn/Item 模型，事件流式输出
  - 支持 approvals（server→client 请求），天然对齐 `gate.blocked`
- `codex exec --json`（参考 `codex/codex-rs/exec/`）：一次性跑完并输出 JSONL 事件
- 细节：见 [`docs/agentmesh/adapters/codex.md`](./adapters/codex.md)

**交付物**
- `codex-app-server` client（初始化、thread/start|resume、turn/start、interrupt、approve/deny）
- 任务目录落盘原始记录：`agents/<instance>/runtime/events.jsonl`、`agents/<instance>/runtime/requests.jsonl`、`agents/<instance>/session.json`

**用户介入**
- 当出现 approval request：任务进入 `gate.blocked`，用户在 `shared/human-notes.md` 决策 allow/deny（或补充约束）

## Phase 3：产物提取（从 Codex items/events 生成 AgentMesh artifacts）

**目标**
- 把 Codex 的 items/events 转成 AgentMesh 稳定产物：报告、契约、变更摘要、下一步行动

**交付物**
- `DiagnosticReport`/`API Contract`/`Test Report` 等模板的“填充器”（从 item 里提取并落盘）
- `events.jsonl` 的统一事件：`agent.turn.started/completed`、`artifact.written`、`gate.blocked/approved/rejected`

**用户介入**
- 对提取出的产物进行验收/驳回/补充，触发重跑或继续

## Phase 3.5：GUI（Artifacts-first）

**目标**
- 提供用户可感知的 GUI 页面（不嵌入/复刻各家 TUI）
- 把 “任务状态 + 产物 + gates/approval” 以可操作的方式呈现出来

**交付物**
- 任务列表/任务详情/产物浏览/事件流/审批弹窗
- GUI ↔ orchestrator 的最小 API（HTTP + SSE/WS）

细节见：[`docs/agentmesh/gui.md`](./gui.md)

## Phase 4：Skills 与工具集装配（按固定定义，不扩展）

**目标**
- 让每个 agent 可“预装”一组 skills（能力包），增强特定领域能力
- skills 定义遵循 `docs/references/skills/README.md`，不做协议扩展

**交付物**
- skills 仓库与选择机制（例如 `.agentmesh/agents/<agent>/skills/<skill>/SKILL.md`）
- adapter 侧落地：各 TUI 如何启用 skills（插件/目录/启动参数/prompt 指引）

**用户介入**
- 任务中途增删 skill set（例如切换到“debugging skill set”）
- 直接编辑 skill 内容（指令/脚本/资源），作为快速纠错手段

## Phase 5（可选）：标准化与互通（A2A/ACP 作为兼容层）

当需要与外部生态对接或做企业级集成时，再考虑：

- A2A：把 Task/Artifact 的本地模型“对齐/映射”为 A2A 语义
- ACP：把控制台交互抽象为 editor↔orchestrator 的标准接口
