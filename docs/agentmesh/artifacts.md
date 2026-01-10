# AgentMesh 产物形态规范（Artifacts + 人工介入点）

> 目标：把一次 `User ↔ Agents` 的协作过程，落盘成**可追踪、可编辑、可复现**的产物集合，让用户可以在任何环节介入、注入指导、纠错。

本规范刻意“协议无关”：即便未来接入 A2A/ACP/不同 vendor agent，产物形态也尽量保持稳定。

## 1. 顶层目录：`.agentmesh/`

在真实项目中通常会使用一个专用目录，避免污染业务代码：

```
.agentmesh/
  agents/                       # 可复用的 Agent Spec（模板/编译产物）
  tasks/                        # 所有任务落盘
  locks/                        # （可选）并发控制锁（例如 shared workspace 单写锁）
  registry/                     # （可选）运行时/工具元数据缓存（threads、rollouts 等）
  logs/                         # （可选）编排器运行日志（非任务产物）
```

> 本仓库当前的 `agents/*/agents.md` 可视为“模板库”，未来可复制/同步到 `.agentmesh/agents/`。

## 2. Task Directory（任务目录）

每次任务交互生成一个目录：`.agentmesh/tasks/<task_id>/`。

```
.agentmesh/tasks/<task_id>/
  README.md                     # 人类入口：目标、状态、里程碑、关键链接（必需）
  task.yaml                     # 机器入口：状态机、拓扑、依赖、gating（常见）
  events.jsonl                  # 事件流：状态变化、产物更新、人工介入（常见）
  shared/
    context-manifest.yaml       # “显式共享”清单：哪些文件/片段作为 task context（常见）
    human-notes.md              # 人工指导/纠错入口（常见）
    contracts/                  # 契约中心（API/Schema/Error model）
    decisions/                  # 决策记录（ADR/权衡/结论）
    reports/                    # 汇总报告（joined summary）
  agents/
    <agent_instance_id>/
      README.md                 # 该 agent 在本任务内的索引（常见）
      session.json              # 适配层会话句柄（resume id / vendor info）（常见）
      runtime/                  # 工具侧原始记录（常见）
        requests.jsonl          # （可选）向工具发送的请求（JSONL）
        events.jsonl            # 工具产生的事件流（JSONL）
        stderr.log              # （可选）工具 stderr 原样记录（排障）
        rollout.jsonl           # （可选）工具自身落盘的会话/rollout 拷贝或引用
      artifacts/
        ...                     # 该 agent 产物（md/json/png/...）
```

### 2.1.1 `agents/<agent_instance_id>/session.json`（会话句柄：支持 Awaiting/Dormant）

为实现 `Awaiting`（可恢复待命）与 `Dormant`（序列化休眠），通常会把“适配层恢复会话所需的信息”落盘到 `session.json`：

```json
{
  "agent": "db",
  "instance": "db-1",
  "adapter": "codex-app-server",
  "vendorSession": {
    "tool": "codex",
    "threadId": "thr_123",
    "cwd": "/path/to/repo",
    "codexHome": "./codex_home",
    "rolloutPath": "/Users/me/.codex/rollouts/thr_123.jsonl"
  },
  "recording": {
    "requests": "./runtime/requests.jsonl",
    "events": "./runtime/events.jsonl",
    "stderr": "./runtime/stderr.log",
    "rollout": "./runtime/rollout.jsonl"
  },
  "startedAt": "2025-12-14T15:01:10Z",
  "lastActiveAt": "2025-12-14T15:03:33Z",
  "state": "awaiting"
}
```

> 说明：不同工具的“可恢复能力”差异很大。以 Codex 为例，你可以存 `threadId` 并用 `thread/resume` 继续；对编排器来说，`vendorSession` 只是“如何继续这段工作”的黑盒句柄。

补充：同为 Codex 运行时也可能有两种落地方式：

- `codex app-server`：`vendorSession.threadId = "thr_..."`（Thread/Turn/Item 模型）
- `codex exec --json`：`vendorSession.threadId = "<uuid>"`（JSONL 事件以 `thread.started` 开头）

### 2.1 `task.yaml`（最小字段示例）

`task.yaml` 用于让编排器与人类都能明确“当前跑到哪一步”，并提供“暂停/恢复/重做/改约束”的锚点。

一个常见的最小字段集合如下（可按实现增减）：

```yaml
id: "2025-12-14-xxxx"
title: "Fix signup latency regression"
topology: "swarm"            # swarm | squad
state: "working"             # created | working | input-required | completed | failed | canceled

milestones:
  - id: "m1"
    title: "Evidence collection"
    state: "done"
  - id: "m2"
    title: "Fix + verify"
    state: "working"

roster:
  - instance: "db-1"
    agent: "db"
    state: "awaiting"
  - instance: "log-1"
    agent: "log"
    state: "working"

gates:
  - id: "gate-approve-fix"
    type: "human-approval"
    state: "blocked"         # open | blocked | approved | rejected
    instructionsRef: "./shared/human-notes.md"
```

### 2.2 `events.jsonl`（可追踪性与可审计性）

events.jsonl 常用 JSON Lines 记录每个关键事件，便于：

- 复盘（为什么走到这个结论）
- 追责（哪个 agent 产出了哪个 artifact）
- 自动化（脚本可以读取事件流驱动下一步）

示例（示意）：

```json
{"ts":"2025-12-14T15:01:02Z","type":"task.created","taskId":"...","by":"user"}
{"ts":"2025-12-14T15:01:10Z","type":"agent.started","taskId":"...","agentInstance":"db-1"}
{"ts":"2025-12-14T15:03:33Z","type":"artifact.written","taskId":"...","agentInstance":"db-1","path":"./agents/db-1/artifacts/diagnostic-report.md"}
{"ts":"2025-12-14T15:04:01Z","type":"gate.blocked","taskId":"...","gateId":"gate-approve-fix","reason":"Need human approval to apply migration"}
{"ts":"2025-12-14T15:10:12Z","type":"gate.approved","taskId":"...","gateId":"gate-approve-fix","by":"human","commentRef":"./shared/human-notes.md#approval-1"}
```

> 与 A2A 的映射：A2A 的 `TaskStatusUpdateEvent` / `TaskArtifactUpdateEvent` 可以直接镜像为本地事件流；A2A 的 `input-required` 也能落到 `gate.blocked` + `human-notes.md`。

## 3. 产物文件规范：Markdown + YAML Front Matter

所有“可分享产物”（尤其是会被 explicit attach 的文档）通常会统一为：

- 文件格式：Markdown（`.md`）
- 带 YAML Front Matter 元数据（便于检索/引用/追踪）

### 3.1 最小元数据（示例）

```yaml
---
title: "DB Error Triage Notes"
purpose: "Collect DB-side evidence and hypotheses for incident #123"
tags: ["debug", "postgres", "incident"]

task_id: "2025-12-14-xxxx"
agent_instance: "db-1"
artifact_id: "artifact-...-v1"
---
```

> 与 A2A 的映射：`artifact_id` 对应 A2A `artifactId`；`title`/文件名可对应 A2A 的 `artifact-name`（通常保持稳定以支持“版本演进”）。

## 4. 结构化交换：报告模板（示例）

### 4.1 `DiagnosticReport`（Swarm 诊断统一交付）

可以用 Markdown（方便人读），同时保持结构固定（方便机读/汇总）。

```
---
title: "DiagnosticReport: API 500 on /checkout"
purpose: "Summarize evidence, hypotheses, and next checks"
tags: ["diagnostic-report", "swarm", "incident"]
task_id: "..."
agent_instance: "log-1"
---

## Symptoms

## Evidence
- ...

## Hypotheses (ranked)
1. ...

## Next Checks
- ...

## Proposed Fix (minimal)
- ...
```

### 4.2 API Contract（FE/BE 的共享中心）

API Contract 通常落在 `.agentmesh/tasks/<task_id>/shared/contracts/` 下，保持“契约为中心”的协作方式。

常见的最小结构包含：

- 端点与版本：`/api/v1/...`
- 鉴权：token/cookie/headers
- 错误模型：统一错误码、message、details
- 分页：page/cursor/limit
- 示例（request/response）

## 5. 显式共享（Explicit Attach）

显式共享的核心是：**共享的是“引用 + 最小必要上下文”**，而不是把所有内容拷进对话。

### 5.1 `shared/context-manifest.yaml`

常见做法是用一个 manifest 来显式声明“task context 的组成”，并支持人类编辑。

```yaml
attachments:
  - id: "api-contract-v1"
    kind: "file"
    path: "./shared/contracts/checkout.md"
    reason: "Frontend needs latest response schema"

  - id: "stacktrace-snippet"
    kind: "snippet"
    path: "../../server/checkout.ts"
    range: "120:180"
    reason: "Evidence for hypothesis #2"
```

> 注：`range` 的具体语法可在实现时统一（例如 `startLine:endLine`），关键是它必须能被人类修正。

## 6. 人工介入点（Human-in-the-loop）

为了“用户可随时介入”，产物层通常会提供两个机制：

1) **可编辑的指导入口**：`shared/human-notes.md`
- 用户可以直接写“修正指令/约束/偏好/拒绝某假设”
- 编排器把它当作高优先级上下文（并写入事件流）

2) **可审计的 gating**：在 `task.yaml` 里显式声明需要人类审批的关口
- 例如：写迁移/执行 destructive command/改安全策略/合并 PR 前

当任务进入 `input-required` / `gate.blocked`：

- 编排器应停止自动推进（避免“自动把仓库改坏”）
- 只允许在用户补充/批准后继续

### 6.1 “介入动作”清单（示例）

为了让“介入”变得可操作，UI/CLI 通常会对齐为这些动作（最终都落盘为文件变更 + 事件）：

- **改上下文**：编辑 `shared/context-manifest.yaml`（增删 attach、改 reason、缩小片段范围）
- **改约束/纠错**：编辑 `shared/human-notes.md`（补充事实、否定假设、给出硬约束）
- **改编排**：编辑 `task.yaml`（调整拓扑/roster/依赖/里程碑）
- **验收/驳回**：把结论写入 `human-notes.md` 并触发 `gate.approved / gate.rejected`
- **要求重做**：记录 `artifact.rework-requested`（可通过 human-notes + events 实现）
