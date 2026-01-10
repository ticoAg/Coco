# Design: add-04-subagent-orchestration-lifecycle

## Lifecycle Model (MVP)

### Agent Instance States
本 change 仅要求最小状态集（便于 GUI 与脚本消费）：
- `queued`（可选）/ `running` / `blocked` / `completed` / `failed` / `cancelled`

Rust `AgentInstanceState` 当前为 `pending/active/awaiting/dormant/completed/failed`，实现阶段需要明确映射关系：
- `running` → `active`
- `blocked` → `awaiting` 或 task-level `input-required`
- `cancelled` → task-level `canceled`（或在 event payload 表示 agent cancelled）

### Control Plane Interface
控制面以“短进程 CLI”为主：
- `spawn`：启动 worker 并写入任务目录
- `list`：读取 task.yaml + agents/* runtime 汇总状态
- `wait-any`：阻塞直到任意 worker terminal（或超时）
- `cancel`：发送中断信号并落盘事件

## Open Questions
- 状态的真源：优先以“进程退出 + events.jsonl terminal 事件”推导，还是额外维护一个 `agents/<id>/status.json`？
- `wait-any` 的实现：文件 watcher（跨平台） vs 轮询（MVP 先轮询更简单）。
