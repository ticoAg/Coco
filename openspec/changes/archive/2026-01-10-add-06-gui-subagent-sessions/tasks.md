# Tasks: add-06-gui-subagent-sessions

## 1. Spec
- [x] 定义 GUI 读取任务目录的最小数据源与展示行为（不依赖常驻服务）。
- [x] 定义 subagent 状态的推导规则（从 `runtime/events.jsonl` 与 `artifacts/final.json`）。

## 2. Implementation (apply 阶段执行)
- [x] 在任务详情页新增 “Subagents / Sessions” tab 或区域。
- [x] 列出 `agents/<instance>/`：读取 `session.json`（如存在）与 `artifacts/final.json`（如存在）。
- [x] 展示 `runtime/events.jsonl`：MVP 读取末尾 N 行并支持轮询刷新。

## 3. Validation
- [x] `openspec validate add-06-gui-subagent-sessions --strict`
- [x] `npm -C apps/gui run build`
