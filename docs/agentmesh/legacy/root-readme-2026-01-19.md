# AgentMesh

> 注意：本文为 2026-01-19 从仓库根 `README.md` 迁移的历史备份，可能与当前主线文档不一致。
>
> 当前入口建议从这里开始：
> - 项目导航：[`AgentMesh.md`](../../../AgentMesh.md)
> - 落地文档索引：[`docs/agentmesh/README.md`](../README.md)

AgentMesh 是一个多 `Code Agent` 编排框架，用于协调多个异构 agent（如 `codex`、`Claude Code`、`gemini-cli`、`qwen-code` 等）高效完成复杂开发任务。

> 当前状态：WIP（以设计与产物/运行时落地为主）

## 目标

- 把「一个 agent 扛全栈」升级为「多 agent 专业化分工 + 有序协作」
- 支持并发（`fork`/`join`）、里程碑节奏控制、事件驱动任务流转（`hooks`/`triggers`）
- 通过“显式共享”降低上下文窗口压力：只在需要时共享必要信息
- 让不同厂商/不同模型/不同工具形态的 agent，可以通过统一适配层协作

## 实施方向（与 [`docs/agentmesh/`](..) 同步）

- **Codex-first / Session-based**：先把 Codex 作为第一个可用运行时，通过 `codex app-server`（或 `codex exec --json`）直接读取结构化事件流，落盘为可介入产物。
- 其他工具后续接入时，接入路径通常先尝试其“底层可编程接口/事件流”；如果缺乏此类接口，再把 TUI 录制/抽取作为 fallback。

## 核心概念（简版）

- **Topologies**：按任务选择协作拓扑（`Swarm` / `Squad`）
- **Lifecycle**：Active / Awaiting（沉默待命）/ Dormant（休眠可恢复）
- **Context Scoping**：`Global` / `Task` / `Private`，上下文按需可见
- **Structured Exchange**：用结构化报告/契约替代长对话噪音（例如 `DiagnosticReport`、API Contract）
- **Agent Specs**：由 `Lead/Orchestrator` 设计 agent 阵容，并为每个 agent 生成可复用的 `agents.md`
- **Skills（机制）**：把可复用的“专家指令/脚本/资源”以 Skills 形式保存在磁盘上；每个 agent 可预装不同 skill sets 来增强特定领域能力（如何加载由各运行时/适配器决定）
- **Task（概念）**：一次完整的 `User` - `Agents` 任务交互单元（从需求提出到交付/总结），对应一个可持久化的任务目录；任务内可按 `agent_instance` 归档产出，并通过“显式共享”把必要信息附加给其他 agent（当前仅为设计约定）

从这里开始（项目导航页）：[`AgentMesh.md`](../../../AgentMesh.md)

文档总索引：[`docs/README.md`](../../README.md)

实现评估与多阶段路线图见：[`docs/agentmesh/README.md`](../README.md)

Codex adapter 说明见：[`docs/agentmesh/adapters/codex.md`](../adapters/codex.md)

执行闭环总览见：[`docs/agentmesh/execution.md`](../execution.md)

## 目录约定（示例）

- `.agentmesh/agents/<agent_name>/agents.md`：该 agent 的角色定义（职责、输入/输出、权限、可见范围等），可由 Lead 生成或使用预置模板
- `.agentmesh/agents/<agent_name>/skills/<skill_name>/SKILL.md`：该 agent 的 skill（一个 skill 是包含 `SKILL.md` 的自包含文件夹，可附带脚本/资源）
- `.agentmesh/tasks/<task_id>/README.md`：该任务的入口（目标、状态、里程碑、关键链接）
- `.agentmesh/tasks/<task_id>/shared/**`：任务级共享资产（例如契约、决策、汇总报告等）
- `.agentmesh/tasks/<task_id>/agents/<agent_instance>/README.md`：agent 实例（coder session）在本任务内的产出索引（沉淀/摘要/链接）
- `.agentmesh/tasks/<task_id>/agents/<agent_instance>/**/*.md`：该 agent 实例在任务执行/代码探索中产出的可共享内容（都需要元数据）

## Skills（概念 / 定义 / 使用方法）

Skills 的定义遵循 [[skills/README.md]](docs/references/skills/README.md)。不同产品（例如 codex）如何支持/加载 skills 属于其运行时实现细节（可参考 [[openai-codex/skills.md]](docs/references/openai-codex/skills.md)），不作为本项目对 Skills 的扩展。

- **Skill 是什么**：一个自包含文件夹，包含 `SKILL.md`（YAML frontmatter + 指令正文），可附带脚本与资源文件。
- **`SKILL.md` 的关键字段**：`name` 与 `description`（其余字段与更严格的校验规则由各运行时自行决定）。
- **怎么用**：给不同 agent 预装不同的 skill sets；由对应运行时/adapter 决定如何启用（插件/目录约定/启动参数/prompt 指引等）。

### 创建一个 skill（示例）

在对应 agent 下创建目录与 `SKILL.md`：

```md
---
name: log-triage
description: Summarize logs into a timeline and actionable hypotheses; use when debugging incidents.
---

# Log Triage

- Extract key request_ids / trace_ids.
- Build a short incident timeline.
```

## 模式架构图

### 1) Swarm Mode：Lead 设计阵容 + 并发执行（fork/join）

```mermaid
flowchart LR
  U[User] --> A[Lead / Orchestrator]

  A --> D[Design Agent Roster]
  D --> F[Agent Factory]
  F --> S1["agents/<name>/agents.md<br/>(generated)"]

  A -->|fork| DB[DB Agent]
  A -->|fork| NET[Network Agent]
  A -->|fork| LOG[Log Agent]
  A -->|fork| FE[Frontend Agent]

  DB --> R1[(DiagnosticReport)]
  NET --> R2[(DiagnosticReport)]
  LOG --> R3[(DiagnosticReport)]
  FE --> R4[(DiagnosticReport)]

  R1 -->|join| A
  R2 -->|join| A
  R3 -->|join| A
  R4 -->|join| A

  A --> S[Summary / Next Actions]
```

### 2) Squad Mode：架构师主导的分层小队协作（里程碑推进）

```mermaid
flowchart TB
  U[User] --> ARCH[Architect / Leader]

  subgraph Squad[Squad]
    ARCH --> FE[Frontend Worker]
    ARCH --> BE[Backend Worker]
    ARCH --> QA[QA / Test Worker]
  end

  FE <--> |API Contract| BE
  QA --> |Test Report| ARCH
  FE --> |PR / Review Request| ARCH
  BE --> |PR / Review Request| ARCH
  ARCH --> M[Milestones / Gate]
```

## 内部机制：Task Directory + 显式共享

在 AgentMesh 的语境里，Context Sharing 更像一种内部工作机制：我们把一次协作任务落盘为可持久化的 `Task Directory`；每个 agent 实例（coder session）把产出沉淀在自己的子目录里，需要共享时再通过“显式附加（explicit attach）”引用相关文件/片段，避免全量上下文广播。

### Task Directory & Context Scoping（任务目录 + 作用域）

```mermaid
flowchart LR
  subgraph Global["Global Context (shared)"]
    G1[Repo Structure]
    G2[Tech Decisions]
  end

  subgraph Task["Task Context (shared)"]
    T1[Requirements]
    T2[Relevant Files]
    T3[Contracts]
  end

  subgraph Private["Private Context (agent-local)"]
    P1[Scratchpad]
    P2[Local Notes]
  end

  A[Agent] -->|read| Global
  A[Agent] -->|read/write| Task
  A[Agent] -->|local only| Private

  A[Agent] --> TD["Task Dir<br/>.agentmesh/tasks/&lt;task_id&gt;/"]
  TD --> TS["shared/**<br/>(shared artifacts)"]
  TD --> W["agents/&lt;agent_instance&gt;/<br/>(agent artifacts)"]
  W --> W1["README.md<br/>(index)"]
  W --> W2["artifacts/**/*.md<br/>(with metadata)"]

  A[Agent] -->|explicit attach| X["Attach Task Artifacts<br/>(selected .md files)"]
  X --> Task
```
