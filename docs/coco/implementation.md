# Coco 实现评估（Codex-first / Session-based）

> 目标：把一次任务的执行过程与结果，可靠地落盘为 **Task Directory**（事件流 + 产物 + 人工介入点），并让 GUI/脚本只靠读目录就能复盘与介入。
>
> 本文只讨论 **Codex** 路径：`codex exec --json`（并行 worker）与 `codex app-server`（原生对话/审批）。

执行闭环总览见：[`docs/coco/execution.md`](./execution.md)。

## 1. 关键结论（现阶段优先级）

1) **先定产物，再写引擎**：以任务目录为唯一事实来源（见 [`docs/coco/artifacts.md`](./artifacts.md)）。
2) **不做 TUI 复刻**：不解析 ANSI 屏幕；只消费 Codex 的结构化事件流（JSONL / JSON-RPC）。
3) **并行 worker 先走 `exec --json`**：子进程 + JSONL 事件落盘 + 结构化最终输出，成本最低、最适合并发。
4) **需要审批/原生对话时引入 `app-server`**：把 approvals 作为一等事件处理，并与 `gate.blocked` 对齐。

> 说明：更“宏大”的编排概念（拓扑、生命周期、触发器等）已从主线文档抽离，归档在 [`docs/coco/legacy/`](legacy)，避免与当前可落地范围混在一起。

## 2. Codex 运行时能力对齐（两条路径）

### 2.1 `codex exec --json`

适用：把 Codex 当作一次性 worker 执行器。

- 事件：stdout JSONL（建议原样落盘到 `agents/<instance>/runtime/events.jsonl`）
- 可恢复：事件流里会包含 `thread.started.thread_id`，可用于后续 resume（以实际版本为准）
- 可编排输出：建议强制 `--output-schema`，并用 `--output-last-message` 把最终 JSON 直接落盘到 `agents/<instance>/artifacts/final.json`

并行建议：

- 每个 worker 使用独立 `CODEX_HOME`（避免 sessions/rollouts/cache 互相干扰）
- 并发写入建议用 worktree 隔离；不启用 worktree 时至少要在控制面做单写锁（策略见 [`docs/coco/subagents.md`](./subagents.md)）

### 2.2 `codex app-server`

适用：需要更细粒度的事件、以及 approvals 的交互式处理（例如 GUI 内的 Codex Chat）。

- 协议：stdio 双向通信（JSON-RPC 语义）
- 模型：Thread/Turn/Item（更适合做“原生对话 + 过程可观测”）
- approvals：以 request 形式出现，天然可映射为 `gate.blocked`，等待人类 allow/deny 后再回传

adapter 要点与落盘映射见：[`docs/coco/adapters/codex.md`](./adapters/codex.md)。

## 3. 分层：控制面 / 适配层 / 产物面

- **控制面（Controller）**
  - 创建/更新任务目录：`task.yaml`、`events.jsonl`
  - 调度：spawn/resume/cancel/join（并发管理、写锁、超时）
  - gates：把“需要人类决策”的情况显式化为 `gate.blocked`
  - 汇总：把多个 worker 的 `final.json` join 成任务级报告（`shared/reports/*`）
- **适配层（Codex Adapter）**
  - 负责启动/维护 Codex 进程（exec 子进程 / app-server 常驻进程）
  - 负责记录与转译：requests/events 落盘；将 approvals 映射为 gates
- **产物面（Task Directory）**
  - 任务目录是唯一事实来源；GUI 只读即可渲染任务状态与结果

## 4. 分阶段建议（与路线图对齐）

路线图见：[`docs/coco/roadmap.md`](./roadmap.md)。

一个实际可执行的顺序是：

1) 固化任务目录与报告模板（Artifacts-first）
2) 实现 `codex exec --json` 并行 worker 的最小闭环（spawn → 事件落盘 → final.json → join）
3) 需要审批/原生对话时，再接入 `codex app-server` 并把 approvals 映射到 gates
