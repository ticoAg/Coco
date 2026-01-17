## ADDED Requirements

### Requirement: Evidence Directory Skeleton
系统 SHALL 为每个任务目录创建 evidence 目录，并提供一个稳定的 evidence index 文件：

- `shared/evidence/`
- `shared/evidence/index.json`

其中 `index.json` SHALL 为 JSON 数组（可为空数组），用于列出该任务的 `EvidenceEntry[]`。

#### Scenario: Evidence skeleton exists for every task
- **WHEN** 创建一个新任务
- **THEN** `shared/evidence/` 目录存在
- **AND** `shared/evidence/index.json` 文件存在
- **AND** `shared/evidence/index.json` 可被解析为 JSON 数组

### Requirement: Evidence Entry Format
系统 SHALL 使用结构化 `EvidenceEntry` 来表达一条可引用证据，至少包含以下字段：

- `id`：string（在同一 task 内唯一，推荐 kebab-case）
- `kind`：string（例如：`file-anchor` / `command-execution` / `runtime-event-range`）
- `title`：string
- `summary`：string
- `createdAt`：string（ISO 8601）
- `sources`：array（至少 1 条）

`EvidenceEntry` MAY 包含：

- `artifactRefs`：array of string（指向任务目录内的相对路径，例如 `./agents/<instance>/runtime/events.jsonl`）

#### Scenario: Evidence entry points to a file anchor
- **GIVEN** 一个 worker 产出需要引用某段代码
- **WHEN** 系统写入一条 `EvidenceEntry` 到 `shared/evidence/index.json`
- **THEN** 该 entry 的 `kind` 为 `file-anchor`
- **AND** `sources` 包含 `type=fileAnchor` 的 source，且包含 `path/startLine/endLine`

### Requirement: Evidence Source Types
系统 SHALL 在 `EvidenceEntry.sources[]` 中至少支持以下 source 类型：

1) `fileAnchor`
- 必填：`type = "fileAnchor"`、`path`、`startLine`、`endLine`
- `path` SHALL 为相对路径（相对 repo/workspace root），不得为绝对路径

2) `commandExecution`
- 必填：`type = "commandExecution"`、`command`、`cwd`
- `cwd` SHOULD 为绝对路径或可定位的工作目录标识
- MAY 包含：`exitCode`、`stdoutRef`、`stderrRef`（指向任务目录内相对路径）

3) `runtimeEventRange`
- 必填：`type = "runtimeEventRange"`、`eventsRef`
- `eventsRef` SHALL 指向 JSONL 事件文件（例如 `./agents/<instance>/runtime/events.jsonl`）
- MAY 包含：`startLine`、`endLine`

#### Scenario: Evidence entry points to command output
- **GIVEN** 一个 worker 执行了命令并将 stdout/stderr 落盘
- **WHEN** 系统写入 `kind=command-execution` 的 `EvidenceEntry`
- **THEN** `sources` 包含 `type=commandExecution` 且包含 `stdoutRef` 或 `stderrRef`

### Requirement: Evidence Citation Convention
系统 SHALL 允许在任务目录内的 Markdown 报告/决策文件中用一个简单 token 引用 evidence：

- 约定格式：`evidence:<id>`

GUI/脚本 MAY 解析该 token 并跳转到 `shared/evidence/index.json` 中对应的 entry。

#### Scenario: Joined report cites evidence
- **GIVEN** 某 worker 的结论依赖一条证据 `id=cmd-42`
- **WHEN** 系统生成 `shared/reports/joined-summary.md`
- **THEN** 报告中包含文本 `evidence:cmd-42`
