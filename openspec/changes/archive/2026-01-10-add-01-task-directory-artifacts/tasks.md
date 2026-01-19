# Tasks: add-01-task-directory-artifacts

## 1. Spec
- [x] 将 [`docs/agentmesh/artifacts.md`](../../../../docs/agentmesh/artifacts.md) 的 Task Directory 关键约定固化到 `task-directory` 规格（必需文件、目录、最小字段、兼容策略）。
- [x] 明确 `task.yaml` 与 `events.jsonl` 的“可追踪性”要求（append-only、时间戳、最小事件类型）。

## 2. Implementation (apply 阶段执行)
- [x] 在 `agentmesh-core` 的 `TaskStore::create_task` 中补齐最小落盘文件（如 `shared/human-notes.md`、`shared/context-manifest.yaml`），与 specs 对齐。
- [x] 必要时更新 [`schemas/task.schema.json`](../../../../schemas/task.schema.json)（与 Rust `TaskFile` / GUI types 一致）。
- [x] 更新 [`docs/README.md`](../../../../docs/README.md)：增加一条指向 [`openspec/`](../../..) 的索引入口（说明这里是 specs/changes 的位置）。

## 3. Validation
- [x] `openspec validate add-01-task-directory-artifacts --strict`
- [x] `cargo test -p agentmesh-core`
