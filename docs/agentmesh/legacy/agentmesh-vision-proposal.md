# (Archived) AgentMesh Vision Proposal

> 注意：本文为早期愿景/草案归档，可能包含过时表述或与当前实现方向不完全一致。
>
> 建议优先从以下入口开始：
> - 项目导航页：[`AgentMesh.md`](../../../AgentMesh.md)
> - 落地文档索引：[`docs/agentmesh/README.md`](../README.md)

基于 GitHub Issue [openai/codex #2604](https://github.com/openai/codex/issues/2604) 的讨论内容，结合需求（并发 Debug、架构师把控全栈开发、Silent/Wake 机制、Context 共享等），可以构想一套名为 **"Agent Orchestration & Swarm Protocol" (代理编排与蜂群协议)** 的多 agent 编排特性集

> 实施说明（与本仓库同步）：本项目当前落地方向是 **Codex-first / Session-based**。
>
> - 把成熟 CLI 工具（先做 Codex）当作“coder runtime”，后台维护其 session（例如 Codex 的 `threadId`），并通过底层事件流直接提取结构化输出（`codex app-server` / `codex exec --json`），落盘为 `.agentmesh/tasks/<task_id>/...` 的可介入产物。
> - 这里提到的 “Subagent” 更偏向“角色/分工/阵容”的概念，不绑定某家产品的 Subagents 技术实现，也不要求做多 TUI 控制台。
>
> 具体落地文档见：[`docs/agentmesh/README.md`](../README.md)。
> - 执行闭环总览（Task Directory + Workers + Gates / Evidence-first）见：[`docs/agentmesh/execution.md`](../execution.md)。
> - Codex adapter 说明：[`docs/agentmesh/adapters/codex.md`](../adapters/codex.md)。

这套特性旨在解决单一 Agent 上下文过载和能力泛化的问题，通过**专业化分工**和**有序协作**来提升复杂任务的效率。

以下是针对您描述场景的详细 Feature Proposal（特性提案）：

### 1. 核心架构：多拓扑协作模式 (Multi-Topology Collaboration)

不同的任务需要不同的组织形式，系统应支持动态切换以下两种模式：

#### A. 蜂群模式 (Swarm Mode) - 适用于并发 Debug / 信息搜集

- **场景描述**：面对复杂的报错，需要同时检查数据库日志、API 响应、前端 Console 和云端监控。
- **协作逻辑**：
  - **阵容设计 (Roster Design)**：Lead / Orchestrator 根据任务设计需要哪些 agent 角色（数量、名称、职责、权限、可见范围）。实现上，每个角色会被绑定到一个或多个“coder session”（例如一个 Codex `threadId`）。
  - **Agent 定义生成 (Agent Spec Generation)**：为每个角色生成一份可复用的 `agents.md`（例如 `.agentmesh/agents/db/agents.md`），作为该 agent 的“说明书/运行契约”（Role、Inputs/Outputs、Permissions、Scope、Triggers 等）。
    - 仓库里也可以保留一份模板库（例如 [`agents/db/agents.md`](../../../agents/db/agents.md)），供复制/微调后写入 `.agentmesh/agents/`。
  - **广播触发 (Broadcast Trigger)**：主 Agent 发布一个“诊断任务”，并行派发给 DB Agent, Network Agent, Log Agent。
  - **并行执行 (Parallel Execution)**：所有 agent 实例/会话可并行工作，互不阻塞。
  - **结果聚合 (Result Aggregation)**：各 agent 实例完成后不进行长篇大论，而是返回结构化的 `DiagnosticReport`。主 Agent 收到所有报告后进行综合分析。
- **Key Feature**: `fork_join` 机制。允许主任务分裂（Fork）出多个子任务，等待所有子任务完成（Join）后再继续。

#### B. 阶层/小队模式 (Hierarchical Squad Mode) - 适用于全栈开发

- **场景描述**：架构师把控节奏，前端和后端 Agent 协同开发。
- **角色定义**：
  - **Architect (Leader)**：持有全局需求文档，负责拆分任务，Review 代码，不直接写具体业务逻辑。
  - **Frontend & Backend (Workers)**：专注于特定技术栈（如 React/Next.js 或 Go/Python）。
- **协作逻辑**：
  - **类似“聊天室”的交互**：Frontend Agent 在开发过程中遇到接口不明，可以直接 `@Backend` 提问：“_/api/user/profile 返回的字段定义是什么？_”
  - **节奏控制**：Architect 设置里程碑（Milestone）。只有当前里程碑下的 Frontend/Backend 任务都标记为 `Resolved`，才解锁下一阶段。

---

### 2. 交互与流转控制 (Interaction & Flow Control)

为了实现您提到的“沉默”、“唤醒”和“流转”，需要以下状态机特性：

#### A. 状态管理 (Agent Lifecycle States)

- **Active (活跃)**：正在执行任务或参与对话。
- **Awaiting (待命/沉默)**：任务已完成，保持上下文但**不消耗 Token**，直到被显式唤醒。
- **Dormant (休眠)**：上下文被序列化存储，释放内存，需要重新加载才能工作。

#### B. 触发器与钩子 (Triggers & Hooks)

- **Mention Trigger (`@AgentName`)**：
  - 标准唤醒机制。例如 Frontend 完成了 UI，直接 `@Architect`：“_界面已完成，请 Review。_” 此时 Architect 从 Awaiting 转为 Active。
- **Completion Hook (完成钩子)**：
  - **Auto-Silence**: Agent 完成任务后自动进入 `Awaiting` 状态，减少噪音。
  - **Auto-Forward**: 定义任务链。例如：Backend Agent 完成 API 开发 -> **Trigger** -> QA Agent (生成测试用例) -> **Trigger** -> Architect (验收)。
- **Event Listeners**:
  - 监听特定文件变更（如 `schema.graphql` 变更自动唤醒 Backend Agent 更新 Resolver）。

---

### 3. 上下文与显式共享 (Context Isolation & Explicit Sharing)

Issue #2604 中反复提到 Context Window 是瓶颈。我们需要**按需共享**，而不是全量共享。

- **Context Scoping (上下文作用域)**：
  - **Global Context**: 项目根目录结构、技术选型文档（所有 Agent 可见）。
  - **Task Context**: 当前任务的具体需求（仅相关 Agent 可见）。
  - **Private Context**: Agent 自己的思维链（CoT）、临时变量（对外不可见，避免污染）。
- **Explicit Sharing (显式共享协议)**：
  - 当 Frontend Agent `@Backend` 时，系统不应把 Frontend 所有的 UI 代码发给 Backend，而是允许 Frontend 选择性 Attach 文件或代码片段：
    > "Hey @Backend, I need data for this component. [Attachment: `UserProfile.tsx`]"
  - **API 契约共享**：系统自动维护一个共享的 `interface/contract` 区域，前端后端都能实时读取最新的接口定义，而无需互相询问细节。

---

### 3.1 任务目录 (Task Directory) —— 一种内部机制

在 AgentMesh 的语境里，“Context Sharing”更偏向一种内部工作机制：一次完整的 `User` - `Agents` 交互通常会被组织为一个 `Task`（任务），并落盘为可持久化的任务目录；任务内的 agent 实例（coder session）可以在自己的子目录中沉淀探索过程与结果。需要共享时，通过“显式附加 (explicit attach)”引用必要内容，避免全量上下文广播。

- **Task Directory**：每次任务交互对应一个目录，例如：
  - `.agentmesh/tasks/<task_id>/README.md`（必需）：任务入口（目标、状态、里程碑、关键链接）
  - `.agentmesh/tasks/<task_id>/shared/**`：任务级共享资产（契约、决策、汇总报告等）
  - `.agentmesh/tasks/<task_id>/agents/<agent_instance>/README.md`（常见）：该 agent 实例在本任务内的产出索引（摘要、链接）
  - `.agentmesh/tasks/<task_id>/agents/<agent_instance>/artifacts/**`：探索笔记、决策记录、排查日志、接口契约等（可选，常见）
  - `.agentmesh/tasks/<task_id>/agents/<agent_instance>/runtime/**`：工具侧事件流与 rollout（例如 Codex `events.jsonl` / `rollout.jsonl`，用于复盘与提取）

同时，agent 的“行为定义/说明书”应独立存放为可复用模板：

- **Agent Spec (`agents.md`)**：系统为每个 agent 角色生成一份可复用的 `agents.md`（例如 `.agentmesh/agents/db/agents.md`），指导该角色/会话的行为（Role、Inputs/Outputs、Permissions、Scope、Triggers 等）。
  - 预置模板：框架可内置常用 `agents.md`，供 Lead 直接选用或微调。
- **内容格式**：任务目录内的可分享内容统一使用 Markdown。
- **文件元数据（强制）**：任务目录内所有可分享文件必须带元数据，用于被系统检索、引用、附加与追踪。可以使用 YAML Front Matter：

```yaml
---
title: 'DB Error Triage Notes'
purpose: 'Collect DB-side evidence and hypotheses for incident #123'
tags: ['debug', 'postgres', 'incident']
filepath: ./AgentMesh.md
---
```

- **显式附加 (Explicit Attach)**：Agent 在 @ 其他 agent 或向 Lead 汇报时，不直接“倾倒上下文”，而是选择性附加任务目录中的具体文件（或文件片段）。
- **可追踪性**：当某份任务产出被附加到任务上下文时，系统记录来源（task_id、agent、文件、时间），便于回溯。

### 3.2 Agent Skills —— 可复用的能力包（按固定定义，不扩展）

AgentMesh 把 Skills 视为各家 agent 可共享的一种“能力封装形式”（指令、脚本、资源）。Skills 的定义以 [[skills/README.md]](docs/references/skills/README.md) 为准；不同产品（例如 codex）如何加载/呈现 Skills 属于其运行时实现细节（可参考 [[openai-codex/skills.md]](docs/references/openai-codex/skills.md)），不应反向成为 AgentMesh 的 Skills 规范扩展。

- **Skill 是什么**：一个自包含文件夹，其中包含 `SKILL.md`（YAML frontmatter + 指令正文），并可附带脚本与资源文件。
- **`SKILL.md` 的关键字段**：`name` 与 `description`（其他更严格的校验规则由各运行时自行决定）。
- **如何使用**：给每个 agent 预装不同的 skill sets，以增强特定任务领域能力；由对应运行时/adapter 决定如何启用（插件/目录约定/启动参数/prompt 指引等）。
- **归档方式（按 agent）**：`.agentmesh/agents/<agent_name>/skills/<skill_name>/SKILL.md`（一个 skill 一个文件夹）。

**创建 skill（示例）**：

```md
---
name: api-contract-review
description: Review API contracts for consistency, error models, and versioning; use before frontend integration.
---

# API Contract Review

- Check request/response schemas and error codes.
- Ensure pagination/auth fields are consistent.
```

### 4. 具体的 UI/UX 表现形式 (以聊天室为例)

界面上不应只是单一的对话流，而应演进为 **“Artifacts-first 的任务控制台”**（不要求嵌入/复刻各家 TUI，只要能呈现结构化结果与介入点）：

- **任务概览**：目标、里程碑、阵容（roster）、当前 gates（哪里需要人类批准/补充）。
- **产物视图（核心）**：`shared/reports/*`、`shared/contracts/*`、`shared/decisions/*` 的结构化呈现与 diff。
- **会话视图（可选）**：展示每个 coder session 的“最后结论/关键事件摘要”（来自事件流提取），而不是展示原生 TUI 屏幕。
- **介入入口（必须）**：编辑 `shared/human-notes.md`、调整 `shared/context-manifest.yaml`、对某个 approval 做 allow/deny、触发重跑/继续。

### 总结：我们需要什么样的 Subagent Feature？

基于 Issue 和您的构想，这个 Feature Set 可以概括为：

1.  **可定义角色的 Agent 工厂**：允许用户通过 Prompt 预设 Agent 的职责（Role）、权限（Permissions）和可见范围（Scope）。
2.  **事件驱动的编排引擎**：支持 `onTaskComplete`, `waitFor(@Agent)`, `runParallel` 等原语，实现复杂的任务流转。
3.  **结构化通信协议**：Agent 之间不仅传输自然语言，还传输结构化数据（代码块、文件引用、状态码），并支持显式的上下文剪裁。
4.  **任务目录机制（沉淀与共享）**：每个任务落盘为可持久化的任务目录，agent 实例（coder session）产出按 `agent_instance` 归档；所有可分享文件使用 Markdown + 元数据，作为可检索的协作资产库。

这种设计将把 Coding Agent 从单一的“结对编程伙伴”升级为一支完整的“虚拟软件开发团队”。
