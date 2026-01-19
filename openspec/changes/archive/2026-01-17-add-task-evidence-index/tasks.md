# Tasks: add-task-evidence-index

## 1. Spec
- [x] 1.1 在 `task-directory` 的 spec delta 中增加 Evidence 目录与文件约定。
- [x] 1.2 定义 `EvidenceEntry` 与 `EvidenceSource` 的最小字段集合（以及 source type 枚举）。
- [x] 1.3 定义 Markdown 报告中引用 evidence 的约定（`evidence:<id>`）。

## 2. Implementation
- [x] 2.1 `agentmesh-core`: 创建任务时 scaffold `shared/evidence/` 与 `shared/evidence/index.json`（空数组）。
- [x] 2.2 `agentmesh-orchestrator`: 在 join/report 生成阶段写入 evidence index，并在 `joined-summary.md` 中引用。
- [x] 2.3 增加最小 JSON schema（可选）：[`schemas/evidence-entry.schema.json`](../../../../schemas/evidence-entry.schema.json)，用于稳定校验 evidence 产物。
- [x] 2.4 测试：任务创建会生成 evidence 目录；evidence index 写入符合最小约定。

## 3. Validation
- [x] 3.1 `openspec validate add-task-evidence-index --strict`
- [x] 3.2 `cargo test -p agentmesh-core -p agentmesh-orchestrator`
