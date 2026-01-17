# Tasks: add-orchestrator-controller-loop

## 1. Spec
- [ ] 1.1 定义 Orchestrator 输出 `actions` 的最小 JSON schema（建议新增 `schemas/orchestrator-actions.schema.json`）。
- [ ] 1.2 定义 Controller 全局状态机与单任务状态机（dispatch/monitor/join/gate/resume）。
- [ ] 1.3 定义 task workspace 的目录约定与“结果索引”回写策略（主控只吸收摘要，不吸收全量过程）。
- [ ] 1.4 定义 fork/spawn 两种派生策略与落盘字段（`forkedFrom`、`threadId`、`cwd`、`recordings`）。

## 2. Implementation
- [ ] 2.1 `agentmesh-orchestrator`: 新增 controller loop（读 actions → spawn subagents → wait/join → write reports → handle gates）。
- [ ] 2.2 增加 `StateBoard` 产物：`shared/state-board.md`（append/replace 策略由实现决定）。
- [ ] 2.3 集成 evidence：对关键结论生成 `shared/evidence/index.json`（见 change add-task-evidence-index）。
- [ ] 2.4 适配 codex：支持 `codex-exec`（已存在）与 `codex-app-server`（新增）两条执行路径。
- [ ] 2.5 测试：模拟 orchestrator actions，验证 controller 状态机与落盘产物。

## 3. Validation
- [ ] 3.1 `openspec validate add-orchestrator-controller-loop --strict`
- [ ] 3.2 `cargo test -p agentmesh-orchestrator`
