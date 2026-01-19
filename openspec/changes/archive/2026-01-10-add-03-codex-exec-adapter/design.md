# Design: add-03-codex-exec-adapter

## Decisions

### D1: Use `codex exec --json` as MVP adapter interface
选择 `codex exec --json` 作为 Phase 1/2 的 adapter 接口：
- 优点：实现简单（子进程 + 读 stdout JSONL）、适合并发 worker（<=8）。
- 代价：交互粒度不如 `app-server`（尤其 approvals），但可在后续 change 迁移。

参考：[`docs/agentmesh/adapters/codex.md`](../../../../docs/agentmesh/adapters/codex.md)、[`docs/agentmesh/subagents.md`](../../../../docs/agentmesh/subagents.md)。

### D2: Artifacts-first persistence
adapter 的首要职责是“原始记录 + 可编排最终输出”落盘：
- `runtime/events.jsonl`：stdout JSONL 原样记录
- `runtime/stderr.log`：stderr 原样记录（排障）
- `artifacts/final.json`：结构化最终输出（`--output-last-message`）
- `session.json`：保存 `thread_id`、`cwd`、`codex_home` 等 resume 信息

### D3: Per-worker `CODEX_HOME` isolation
为避免 sessions/rollouts/cache 干扰，每个 worker 使用独立 `CODEX_HOME`，并建议放在任务目录下，保证“任务快照可迁移”。

## Open Questions
- `thread_id` 的提取来源：优先从 JSONL `thread.started` 事件解析；若 `--output-last-message` 已产出但事件缺失，是否需要兜底逻辑？
- `resume` 的最小接口放在哪个层：adapter 内部还是 orchestrator 提供外部命令？
