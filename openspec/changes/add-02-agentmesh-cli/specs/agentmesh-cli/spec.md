## ADDED Requirements

### Requirement: CLI Binary
系统 SHALL 提供 `agentmesh` 命令行工具，用于对任务目录进行读取与编排操作。

#### Scenario: CLI is invokable
- **WHEN** 用户在项目构建后执行 `agentmesh --help`
- **THEN** CLI 输出帮助信息并以退出码 0 结束

### Requirement: Workspace Root Resolution
CLI SHALL 支持通过环境变量 `AGENTMESH_WORKSPACE_ROOT` 指定工作区根目录；当未设置时，CLI MAY 采用与 GUI/Tauri 一致的回退策略。

#### Scenario: Workspace root from env var
- **GIVEN** 设置 `AGENTMESH_WORKSPACE_ROOT=/path/to/workspace`
- **WHEN** 执行 `agentmesh task list`
- **THEN** CLI 从 `/path/to/workspace/.agentmesh/tasks` 读取任务

### Requirement: Create Task Command
CLI SHALL 支持创建任务的最小命令，并将任务落盘到 Task Directory（参见 `task-directory` capability）。

#### Scenario: Create a swarm task
- **WHEN** 执行 `agentmesh task create --title "X" --topology swarm`
- **THEN** 输出新建任务 `id`
- **AND** `.agentmesh/tasks/<id>/task.yaml` 存在且可解析

### Requirement: List/Show Tasks
CLI SHALL 支持列出任务与查看单个任务详情，并支持 `--json` 输出稳定结构（字段与 `TaskFile` 对齐）。

#### Scenario: List tasks as json
- **WHEN** 执行 `agentmesh task list --json`
- **THEN** 输出为 JSON 数组

### Requirement: Read Task Events
CLI SHALL 支持读取任务 `events.jsonl`，并提供分页参数（例如 `--limit`/`--offset`）与 `--type-prefix` 过滤。

#### Scenario: Read first page of events
- **GIVEN** 任务存在且有事件
- **WHEN** 执行 `agentmesh task events <task_id> --limit 50 --offset 0`
- **THEN** 返回最多 50 条事件

