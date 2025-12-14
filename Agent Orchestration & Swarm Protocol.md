基于 GitHub Issue [openai/codex #2604](https://github.com/openai/codex/issues/2604) 的讨论内容，结合需求（并发 Debug、架构师把控全栈开发、Silent/Wake 机制、Context 共享等），可以构想一套名为 **"Agent Orchestration & Swarm Protocol" (代理编排与蜂群协议)** 的 Subagent 特性集

这套特性旨在解决单一 Agent 上下文过载和能力泛化的问题，通过**专业化分工**和**有序协作**来提升复杂任务的效率。

以下是针对您描述场景的详细 Feature Proposal（特性提案）：

### 1. 核心架构：多拓扑协作模式 (Multi-Topology Collaboration)

不同的任务需要不同的组织形式，系统应支持动态切换以下两种模式：

#### A. 蜂群模式 (Swarm Mode) - 适用于并发 Debug / 信息搜集

*   **场景描述**：面对复杂的报错，需要同时检查数据库日志、API 响应、前端 Console 和云端监控。
*   **协作逻辑**：
    *   **阵容设计 (Roster Design)**：Lead / Orchestrator 可以根据当前任务自行设计需要哪些 Subagents（数量、名称、职责、权限、可见范围），而不是被固定为只能调用预置 agent。
    *   **Agent 定义生成 (Agent Spec Generation)**：系统为每个 Subagent 生成一份可复用的 `agents.md`（例如 `agents/db/agents.md`），作为该 agent 的“说明书/运行契约”（Role、Inputs/Outputs、Permissions、Scope、Triggers 等）。
        *   同时系统预置一些常用 agent 的 `agents.md` 模板，便于直接复用或轻微改造。
    *   **广播触发 (Broadcast Trigger)**：主 Agent 发布一个“诊断任务”，并行派发给 DB Agent, Network Agent, Log Agent。
    *   **并行执行 (Parallel Execution)**：所有 Subagents 同时工作，互不阻塞。
    *   **结果聚合 (Result Aggregation)**：Subagents 完成后不进行长篇大论，而是返回结构化的 `DiagnosticReport`。主 Agent 收到所有报告后进行综合分析。
*   **Key Feature**: `fork_join` 机制。允许主任务分裂（Fork）出多个子任务，等待所有子任务完成（Join）后再继续。

#### B. 阶层/小队模式 (Hierarchical Squad Mode) - 适用于全栈开发
*   **场景描述**：架构师把控节奏，前端和后端 Agent 协同开发。
*   **角色定义**：
    *   **Architect (Leader)**：持有全局需求文档，负责拆分任务，Review 代码，不直接写具体业务逻辑。
    *   **Frontend & Backend (Workers)**：专注于特定技术栈（如 React/Next.js 或 Go/Python）。
*   **协作逻辑**：
    *   **类似“聊天室”的交互**：Frontend Agent 在开发过程中遇到接口不明，可以直接 `@Backend` 提问：“*/api/user/profile 返回的字段定义是什么？*”
    *   **节奏控制**：Architect 设置里程碑（Milestone）。只有当前里程碑下的 Frontend/Backend 任务都标记为 `Resolved`，才解锁下一阶段。

---

### 2. 交互与流转控制 (Interaction & Flow Control)

为了实现您提到的“沉默”、“唤醒”和“流转”，需要以下状态机特性：

#### A. 状态管理 (Agent Lifecycle States)
*   **Active (活跃)**：正在执行任务或参与对话。
*   **Awaiting (待命/沉默)**：任务已完成，保持上下文但**不消耗 Token**，直到被显式唤醒。
*   **Dormant (休眠)**：上下文被序列化存储，释放内存，需要重新加载才能工作。

#### B. 触发器与钩子 (Triggers & Hooks)
*   **Mention Trigger (`@AgentName`)**：
    *   标准唤醒机制。例如 Frontend 完成了 UI，直接 `@Architect`：“*界面已完成，请 Review。*” 此时 Architect 从 Awaiting 转为 Active。
*   **Completion Hook (完成钩子)**：
    *   **Auto-Silence**: Agent 完成任务后自动进入 `Awaiting` 状态，减少噪音。
    *   **Auto-Forward**: 定义任务链。例如：Backend Agent 完成 API 开发 -> **Trigger** -> QA Agent (生成测试用例) -> **Trigger** -> Architect (验收)。
*   **Event Listeners**:
    *   监听特定文件变更（如 `schema.graphql` 变更自动唤醒 Backend Agent 更新 Resolver）。

---

### 3. 上下文与显式共享 (Context Isolation & Explicit Sharing)

Issue #2604 中反复提到 Context Window 是瓶颈。我们需要**按需共享**，而不是全量共享。

*   **Context Scoping (上下文作用域)**：
    *   **Global Context**: 项目根目录结构、技术选型文档（所有 Agent 可见）。
    *   **Task Context**: 当前任务的具体需求（仅相关 Agent 可见）。
    *   **Private Context**: Agent 自己的思维链（CoT）、临时变量（对外不可见，避免污染）。
*   **Explicit Sharing (显式共享协议)**：
    *   当 Frontend Agent `@Backend` 时，系统不应把 Frontend 所有的 UI 代码发给 Backend，而是允许 Frontend 选择性 Attach 文件或代码片段：
        > "Hey @Backend, I need data for this component. [Attachment: `UserProfile.tsx`]"
    *   **API 契约共享**：系统自动维护一个共享的 `interface/contract` 区域，前端后端都能实时读取最新的接口定义，而无需互相询问细节。

---

### 3.1 Subagent 工作空间 (Agent Workspace) —— 一种内部机制

“Context Sharing”是 AgentMesh 的内部工作机制之一：每个创建出的 subagent 都有自己的工作空间（一个子目录），用于沉淀可分享的产出与探索过程；系统通过“显式附加 (explicit attach)”把其中必要内容共享给其他 agent / Lead，避免全量上下文广播。

*   **Workspace Directory**：每个 subagent 对应一个目录，例如：
    *   `workspaces/<agent_instance>/README.md`（必需）：该 subagent 的工作空间入口（索引、摘要、链接）
    *   `workspaces/<agent_instance>/**/*.md`：探索笔记、决策记录、排查日志、接口契约等（可选，但推荐）

同时，agent 的“行为定义/说明书”应独立存放为可复用模板：

*   **Agent Spec (`agents.md`)**：系统为每个 agent 生成一份可复用的 `agents.md`（例如 `agents/db/agents.md`），指导 subagent 的行为（Role、Inputs/Outputs、Permissions、Scope、Triggers 等）。
    *   预置模板：框架可内置常用 `agents.md`，供 Lead 直接选用或微调。
*   **内容格式**：工作空间内的可分享内容统一使用 Markdown。
*   **文件元数据（强制）**：工作空间内所有可分享文件必须带元数据，用于被系统检索、引用、附加与追踪。建议使用 YAML Front Matter：

    ```yaml
    ---
    title: "DB Error Triage Notes"
    purpose: "Collect DB-side evidence and hypotheses for incident #123"
    tags: ["debug", "postgres", "incident"]
    related:
      - "DiagnosticReport"
      - "schema.graphql"
    ---
    ```

*   **显式附加 (Explicit Attach)**：Agent 在 @ 其他 agent 或向 Lead 汇报时，不直接“倾倒上下文”，而是选择性附加工作空间中的具体文件（或文件片段）。
*   **可追踪性**：当某份工作空间产出被附加到任务上下文时，系统记录来源（agent、文件、时间、任务 ID），便于回溯。

### 4. 具体的 UI/UX 表现形式 (以聊天室为例)

界面上不应只是单一的对话流，而应演进为 **"Mission Control Center"**：

*   **主频道 (Main Channel)**：用户与 Architect 的对话，发布总体指令。
*   **侧边栏/子频道 (Side Threads)**：
    *   Subagents 之间的协作细节（如前端和后端的争论）折叠在子频道中，不干扰主视图。
    *   用户可以点击展开查看详情，或者只看 Architect 给出的最终摘要。
*   **状态面板 (Team Status)**：
    *   显示当前活跃的 Agent 列表。
    *   示例：
        *   🤖 **Architect**: *Reviewing PR...*
        *   🎨 **Frontend**: *Awaiting Backend response* (Blocked)
        *   ⚙️ **Backend**: *Coding `user_service.py`* (Working)

### 总结：我们需要什么样的 Subagent Feature？

基于 Issue 和您的构想，这个 Feature Set 可以概括为：

1.  **可定义角色的 Agent 工厂**：允许用户通过 Prompt 预设 Agent 的职责（Role）、权限（Permissions）和可见范围（Scope）。
2.  **事件驱动的编排引擎**：支持 `onTaskComplete`, `waitFor(@Agent)`, `runParallel` 等原语，实现复杂的任务流转。
3.  **结构化通信协议**：Agent 之间不仅传输自然语言，还传输结构化数据（代码块、文件引用、状态码），并支持显式的上下文剪裁。
4.  **工作空间机制（沉淀与共享）**：每个 subagent 拥有独立工作空间目录，所有可分享文件使用 Markdown + 元数据，作为可检索的协作资产库。

这种设计将把 Coding Agent 从单一的“结对编程伙伴”升级为一支完整的“虚拟软件开发团队”。
