# 执行闭环（Codex-first / Artifacts-first）

> 目标：用 **Codex CLI** 作为后台执行器，把一次任务的过程与结果落盘为可复盘的 **Task Directory**（事件流 + 产物 + 人工介入点）。
>
> 本仓库当前文档只描述 Codex 这条路径：不做多 TUI 控制台、不解析 ANSI 屏幕；只消费 `codex exec --json` / `codex app-server` 的结构化事件。

## 1. 设计目标（最小闭环）

- **可复盘**：每次任务都有唯一事实来源：`.agentmesh/tasks/<task_id>/`
- **可并发**：同一个任务可启动多个 Codex worker 并行探索/实现（必要时用 worktree 隔离写入）
- **低上下文污染**：主控/GUI 只读取“结果索引（路径 + 摘要 + 证据引用）”，不吞大量过程日志
- **可介入**：遇到审批/信息缺口 → `gate.blocked` → 人类补充后继续（Human-in-the-loop）

## 2. 核心组件（职责分离）

- **Task Directory（产物面）**
  - 任务事实来源：`task.yaml`、`events.jsonl`、`shared/**`、`agents/**`
  - 目录规范见：[`docs/agentmesh/artifacts.md`](./artifacts.md)
- **Controller（程序状态机）**
  - 负责：创建任务目录、派发 worker、监听完成、join 汇总、写入 gates/事件
- **Orchestrator（模型，可选）**
  - 负责：规划/拆解，输出结构化 actions；由 Controller 执行
- **Codex Runtime（执行器）**
  - `codex exec --json`：适合并行 worker（一次性执行 + JSONL 事件）
  - `codex app-server`：适合原生对话/细粒度事件/审批交互（stdio JSON-RPC）

## 3. 两条可用的执行路径

### 3.1 `codex exec --json`：并行 worker（MVP）

适用：把 Codex 当作“可并发执行的 worker”，每个 worker 跑完交付结构化结果，Controller 再 join。

建议约定：

- 每个 worker 使用独立 `CODEX_HOME`（避免 session/缓存互相污染）
- 通过 `--output-schema` 强制最终输出结构化 JSON（便于 join）
- 通过 `--output-last-message` 直接把最终结果落盘到 `artifacts/final.json`（GUI/Controller 无需二次抽取）

落盘（示意）：

```
.agentmesh/tasks/<task_id>/
  agents/<instance>/
    runtime/events.jsonl
    runtime/stderr.log
    artifacts/final.json
    session.json
```

### 3.2 `codex app-server`：原生对话 / 审批 / 更细粒度事件

适用：需要更交互式的体验（例如 GUI 内的 Codex Chat）、或需要把审批（allow/deny）作为一等事件处理。

特点：

- stdio 双向通信（JSON-RPC 语义）
- Thread/Turn/Item 模型（便于精细记录与恢复）
- approvals 以 request 形式出现，天然可映射为 `gate.blocked`

## 4. Gates（人工介入点）

最小约定：

- 任何“需要人类决策”的情况（审批/缺信息/安全敏感）都写入任务事件流：
  - `events.jsonl`: `gate.blocked` / `gate.approved` / `gate.rejected`
- 人类入口统一指向：`shared/human-notes.md`

这样 GUI 不依赖常驻服务，也能通过读目录明确知道“现在卡在哪里、需要谁做什么”。

## 5. Evidence-first（避免复制大段日志）

为了让结果可审计、可引用、可复现，建议把关键证据抽取为索引：

- `shared/evidence/index.json`：列出 EvidenceEntry（指向命令/文件锚点/事件范围等）
- 报告中只引用证据 ID（例如 `evidence:cmd-42`），而不是粘贴长输出

## 6. 推荐阅读顺序

1) [`docs/agentmesh/artifacts.md`](./artifacts.md)：Task Directory 与产物规范（事实来源）
2) [`docs/agentmesh/subagents.md`](./subagents.md)：如何用 `codex exec --json` 跑并行 workers
3) [`docs/agentmesh/adapters/codex.md`](./adapters/codex.md)：Codex adapter（exec / app-server）接入要点
4) [`docs/agentmesh/gui.md`](./gui.md)：GUI（Artifacts-first + 可选 Codex Chat）
