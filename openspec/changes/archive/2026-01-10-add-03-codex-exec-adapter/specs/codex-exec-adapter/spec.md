## ADDED Requirements

### Requirement: External `codex` Dependency
系统 SHALL 将 `codex` 视为外部可执行依赖（通过 PATH 发现），并在缺失时给出可理解的错误信息。

#### Scenario: Codex not installed
- **GIVEN** PATH 中不存在 `codex`
- **WHEN** 启动一个 codex worker
- **THEN** worker 进入失败状态并记录错误原因（不导致 orchestrator 崩溃）

### Requirement: Spawn Worker via `codex exec --json`
系统 SHALL 通过子进程调用 `codex exec --json` 启动 worker，并将 stdout 视为 JSONL 事件流；同时将 stdout/stderr 与最终输出落盘到 Task Directory：

- `agents/<instance>/runtime/events.jsonl`：stdout JSONL 原样追加写入
- `agents/<instance>/runtime/stderr.log`：stderr 原样追加写入
- `agents/<instance>/artifacts/final.json`：最终结构化输出（推荐使用 `--output-last-message`）

worker 启动命令最小形态 SHOULD 接近：

```
CODEX_HOME="<task_dir>/agents/<instance>/codex_home" \
codex exec --json \
  -C "<cwd>" \
  --output-schema "<repo>/schemas/worker-output.schema.json" \
  --output-last-message "<task_dir>/agents/<instance>/artifacts/final.json" \
  "<PROMPT>"
```

#### Scenario: Start worker and record events
- **WHEN** worker 启动
- **THEN** `agents/<instance>/runtime/events.jsonl` 持续写入 JSONL 事件

### Requirement: Per-Worker `CODEX_HOME`
系统 SHALL 为每个 worker 设置独立 `CODEX_HOME`，以隔离 sessions/rollouts/cache（实现 MAY 提供显式开关用于调试/兼容场景）。

#### Scenario: Each worker uses its own codex home
- **WHEN** 同一 task 并发启动两个 worker
- **THEN** 两个 worker 的 `CODEX_HOME` 指向不同目录

### Requirement: Worker Session Persistence
系统 SHALL 将用于恢复会话的最小信息落盘到 `agents/<instance>/session.json`，至少包含：
- `adapter = "codex-exec"`
- `vendorSession.tool = "codex"`
- `vendorSession.threadId`（从事件流解析得到）
- `vendorSession.cwd`（worker 运行目录）
- `vendorSession.codexHome`（worker 的 CODEX_HOME）
- `recording.events` 指向 runtime events 文件
- `recording.stderr` 指向 runtime stderr 文件

#### Scenario: Resume metadata exists after start
- **WHEN** worker 启动并收到 `thread.started`
- **THEN** `agents/<instance>/session.json` 写入 `threadId`

### Requirement: Structured Final Output
系统 SHALL 通过 `--output-schema schemas/worker-output.schema.json` 约束 worker 最终输出，并将最终消息落盘为 `agents/<instance>/artifacts/final.json`（推荐使用 `--output-last-message`）。

#### Scenario: Final output is available without parsing JSONL
- **WHEN** worker 正常结束
- **THEN** `agents/<instance>/artifacts/final.json` 存在
- **AND** 内容满足 `schemas/worker-output.schema.json`

### Requirement: Exit Code Mapping and Outcome Semantics
系统 SHALL 将 worker 的“结果语义”统一映射为：

- 若 `artifacts/final.json.status == "success"`：worker 结果为 `success`
- 若 `artifacts/final.json.status == "blocked"`：worker 结果为 `blocked`
- 若 `artifacts/final.json.status == "failed"`：worker 结果为 `failed`
- 若进程退出码非 0 且 `artifacts/final.json` 不存在或不可解析：worker 结果为 `failed`

#### Scenario: Blocked worker maps to blocked outcome
- **GIVEN** `artifacts/final.json.status == "blocked"`
- **WHEN** worker 退出
- **THEN** orchestrator/GUI 将该 worker 视为 `blocked`

### Requirement: Stderr Recording
系统 SHALL 将 worker stderr 原样落盘（例如 `agents/<instance>/runtime/stderr.log`），用于排障与审计。

#### Scenario: Capture stderr logs
- **WHEN** worker 执行外部命令或发生错误
- **THEN** stderr 信息可在 `runtime/stderr.log` 中找到
