# AgentMesh

AgentMesh 是一个供应商无关（vendor-agnostic）的多 Code Agent 编排框架，用于协调多个异构 agent（如 Codex、Claude、Gemini、Qwen 等）高效完成复杂开发任务。

> 当前状态：WIP（以设计与协议沉淀为主）

## 目标

- 把「一个 agent 扛全栈」升级为「多 agent 专业化分工 + 有序协作」
- 支持并发（fork/join）、里程碑节奏控制、事件驱动任务流转（hooks/triggers）
- 通过“显式共享”降低上下文窗口压力：只在需要时共享必要信息
- 让不同厂商/不同模型/不同工具形态的 agent，可以通过统一适配层协作

## 核心概念（简版）

- **Topologies**：按任务选择协作拓扑（Swarm / Squad）
- **Lifecycle**：Active / Awaiting（沉默待命）/ Dormant（休眠可恢复）
- **Context Scoping**：Global / Task / Private，上下文按需可见
- **Structured Exchange**：用结构化报告/契约替代长对话噪音（例如 `DiagnosticReport`、API Contract）
- **Agent Specs**：由 Lead/Orchestrator 设计 agent 阵容，并为每个 agent 生成可复用的 `agents.md`
- **Agent Workspace（机制）**：每个 subagent 绑定一个工作空间目录，用 Markdown（带元数据）沉淀可分享内容（当前仅为设计约定）

详细设想见：`Agent Orchestration & Swarm Protocol.md`。

## 目录约定（建议）

- `agents/<agent_name>/agents.md`：该 agent 的角色定义（职责、输入/输出、权限、可见范围等），可由 Lead 生成或使用预置模板
- `workspaces/<agent_instance>/README.md`：subagent 的工作空间入口（沉淀/索引/可共享信息）
- `workspaces/<agent_instance>/**/*.md`：该 subagent 在任务执行/代码探索中产出的可共享内容（都需要元数据）

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

## 内部机制：Subagent Workspace + 显式共享

Context Sharing 不是一种“交互模式”，而是 AgentMesh 的内部工作机制：每个 subagent 拥有独立工作空间，系统在需要时把其中的内容“显式附加（explicit attach）”到协作里，避免全量上下文广播。

### Workspace & Context Scoping（工作空间 + 作用域）

```mermaid
flowchart LR
  subgraph Global[Global Context (shared)]
    G1[Repo Structure]
    G2[Tech Decisions]
  end

  subgraph Task[Task Context (shared)]
    T1[Requirements]
    T2[Relevant Files]
    T3[Contracts]
  end

  subgraph Private[Private Context (agent-local)]
    P1[Scratchpad]
    P2[Local Notes]
  end

  A[Agent] -->|read| Global
  A[Agent] -->|read/write| Task
  A[Agent] -->|local only| Private

  A[Agent] --> W["Workspace Dir<br/>workspaces/&lt;agent_instance&gt;/"]
  W --> W1["README.md<br/>(index)"]
  W --> W2["notes/*.md<br/>(with metadata)"]

  A[Agent] -->|explicit attach| X["Attach Workspace Artifacts<br/>(selected .md files)"]
  X --> Task
```
