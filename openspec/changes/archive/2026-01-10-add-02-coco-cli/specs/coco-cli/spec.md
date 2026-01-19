## ADDED Requirements

### Requirement: CLI Binary
系统 SHALL 提供 `coco` 命令行工具，用于对任务目录进行读取与编排操作。

#### Scenario: CLI is invokable
- **WHEN** 用户在项目构建后执行 `coco --help`
- **THEN** CLI 输出帮助信息并以退出码 0 结束

### Requirement: Command Set (MVP)
CLI SHALL 提供 `task` 命令组，覆盖 MVP 的“任务与事件”读写需求：

- `coco task create`
- `coco task list`
- `coco task show <task_id>`
- `coco task events <task_id>`

#### Scenario: Task commands are discoverable
- **WHEN** 用户执行 `coco task --help`
- **THEN** CLI 显示上述子命令与参数说明

### Requirement: Output Format (human + --json)
CLI 的默认输出 SHOULD 面向人类阅读；当指定 `--json` 时，CLI SHALL 输出仅包含 JSON 的稳定结构（便于 GUI/脚本消费），字段命名与 `TaskFile`/`TaskEvent` 对齐。

#### Scenario: List tasks as json
- **WHEN** 执行 `coco task list --json`
- **THEN** 输出为 JSON 数组

#### Scenario: Show task as json
- **WHEN** 执行 `coco task show <task_id> --json`
- **THEN** 输出为 JSON 对象

#### Scenario: Create task outputs id
- **WHEN** 执行 `coco task create --title "X" --topology swarm --json`
- **THEN** 输出 JSON 对象，包含字段 `id`

### Requirement: Exit Codes
CLI SHALL 使用以下退出码约定：

- `0`：成功
- `2`：用法/参数错误（例如缺少必需参数）
- `3`：资源不存在（例如 task not found）
- `1`：其他错误（I/O、解析等）

#### Scenario: Task not found
- **WHEN** 执行 `coco task show <missing_task_id>`
- **THEN** CLI 以退出码 3 结束

### Requirement: Workspace Root Resolution
CLI SHALL 支持通过环境变量 `COCO_WORKSPACE_ROOT` 指定工作区根目录；当未设置时，CLI SHALL 采用与 GUI/Tauri 一致的回退策略与优先级：

1) `COCO_WORKSPACE_ROOT`
2) repo dev fallback（debug 构建时：若 repo root 存在 [`.coco/`](../../../../../../.coco)，则使用 repo root）
3) app-data/workspace（应用数据目录下的 `workspace/` 子目录）

#### Scenario: Workspace root from env var
- **GIVEN** 设置 `COCO_WORKSPACE_ROOT=/path/to/workspace`
- **WHEN** 执行 `coco task list`
- **THEN** CLI 从 `/path/to/workspace/.coco/tasks` 读取任务

### Requirement: Create Task Command
CLI SHALL 支持创建任务的最小命令，并将任务落盘到 Task Directory（参见 `task-directory` capability）。

#### Scenario: Create a swarm task
- **WHEN** 执行 `coco task create --title "X" --topology swarm`
- **THEN** 输出新建任务 `id`
- **AND** `.coco/tasks/<id>/task.yaml` 存在且可解析

### Requirement: List/Show Tasks
CLI SHALL 支持列出任务与查看单个任务详情，并支持 `--json` 输出稳定结构（字段与 `TaskFile` 对齐）。

#### Scenario: Show task in human mode
- **GIVEN** 任务存在
- **WHEN** 执行 `coco task show <task_id>`
- **THEN** CLI 输出包含该任务的 `id` 与 `title`

### Requirement: Read Task Events
CLI SHALL 支持读取任务 `events.jsonl`，并提供分页参数（例如 `--limit`/`--offset`）与 `--type-prefix` 过滤。

#### Scenario: Read first page of events
- **GIVEN** 任务存在且有事件
- **WHEN** 执行 `coco task events <task_id> --limit 50 --offset 0`
- **THEN** 返回最多 50 条事件
