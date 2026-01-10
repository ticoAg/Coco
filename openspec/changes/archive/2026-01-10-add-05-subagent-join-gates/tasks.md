# Tasks: add-05-subagent-join-gates

## 1. Spec
- [x] 定义 join 输入/输出与最小报告模板（以 worker-output schema 为输入）。
- [x] 定义 gates 的落盘结构（`task.yaml.gates[]`）与事件写入规则（`gate.blocked/approved/rejected`）。

## 2. Implementation (apply 阶段执行)
- [x] 实现 join 产物生成：`shared/reports/joined-summary.md`（可选 `joined-summary.json`）。
- [x] 当任一 worker `blocked` 时：创建/更新 gate，设置 task 为 `input-required`，并指向 `shared/human-notes.md`。
- [x] 增加最小报告模板（可复用 `templates/*` 或新增 join 模板）。

## 3. Validation
- [x] `openspec validate add-05-subagent-join-gates --strict`
- [x] 增加单测：join 汇总包含所有 worker 的 `summary/questions/nextActions`。
