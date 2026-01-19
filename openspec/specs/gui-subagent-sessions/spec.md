# gui-subagent-sessions Specification

## Purpose
定义 GUI 的 Subagents / Sessions 视图：仅通过读取 Task Directory（`agents/<instance>/...`）来呈现每个 subagent session 的状态、最后更新时间、结构化最终输出与 runtime 事件，支持 artifacts-first 展示与“无常驻服务”的最小可用交互。
## Requirements
### Requirement: Sessions View
GUI SHALL 在任务详情中展示该任务的 subagents/sessions 概览，并至少包含：agent instance id（目录名）、状态（按推导规则）、最后更新时间（按推导规则）。

#### Scenario: List sessions from task directory
- **GIVEN** `.agentmesh/tasks/<task_id>/agents/` 下存在一个或多个 agent instance 目录
- **WHEN** 用户打开任务详情页
- **THEN** GUI 展示 sessions 列表

### Requirement: Minimal Data Source (Task Directory Only)
GUI SHALL 仅通过读取任务目录来构建 sessions 视图，不依赖常驻服务，并将 `agents/<instance>/` 目录视为一个 session。
GUI MAY 读取以下文件（如存在）：
- `agents/<instance>/session.json`
- `agents/<instance>/artifacts/final.json`
- `agents/<instance>/runtime/events.jsonl`

当任意文件缺失或不可解析时，GUI SHALL 仍可展示该 session（以 unknown/空值呈现缺失字段）。

#### Scenario: Render sessions with missing artifacts
- **GIVEN** 某个 `agents/<instance>/` 仅存在 `runtime/events.jsonl` 或仅存在 `artifacts/final.json`
- **WHEN** 用户打开任务详情页
- **THEN** GUI 仍列出该 session，并对缺失字段显示 unknown/空值

### Requirement: Derive Session Status
GUI SHALL 以 artifacts-first 的方式推导 session 状态：
1. 若 `artifacts/final.json` 存在且包含 `status` 字段，则：
   - `success` → `completed`
   - `blocked` → `blocked`
   - `failed` → `failed`
   - 其他值 → `unknown`
2. 否则若 `runtime/events.jsonl` 存在且非空 → `running`
3. 否则 → `unknown`

#### Scenario: Status from final.json
- **GIVEN** `artifacts/final.json` 存在且 `status` 为 `success`
- **WHEN** GUI 渲染 sessions 列表
- **THEN** 该 session 状态为 `completed`

#### Scenario: Status fallback to events.jsonl
- **GIVEN** `artifacts/final.json` 不存在 且 `runtime/events.jsonl` 存在且非空
- **WHEN** GUI 渲染 sessions 列表
- **THEN** 该 session 状态为 `running`

### Requirement: Derive Last Updated Time
GUI SHALL 推导 `lastUpdatedAt` 用于 sessions 列表展示，优先级如下：
1. `runtime/events.jsonl` 的 mtime（如存在）
2. `artifacts/final.json` 的 mtime（如存在）
3. `session.json` 的 mtime（如存在）
4. 否则 `lastUpdatedAt` 为 unknown（GUI MAY 显示空值）

#### Scenario: lastUpdatedAt prefers events.jsonl
- **GIVEN** 同一 session 下同时存在 `runtime/events.jsonl` 与 `artifacts/final.json`
- **WHEN** GUI 渲染 sessions 列表
- **THEN** lastUpdatedAt 使用 `runtime/events.jsonl` 的 mtime

### Requirement: Read-Only by Default
GUI SHALL 以只读方式消费任务目录，不要求通过 GUI 执行 spawn/cancel/approve 等写操作（MVP）。

#### Scenario: No write operations required
- **WHEN** 用户浏览 sessions 与 reports
- **THEN** 所有展示均来自读取任务目录文件

### Requirement: Show Worker Final Output
GUI SHALL 展示每个 worker 的结构化最终输出（来自 `agents/<instance>/artifacts/final.json`），至少展示 `status` 与 `summary`。

#### Scenario: Show final.json summary
- **GIVEN** `artifacts/final.json` 存在且可解析
- **WHEN** 用户查看该 session
- **THEN** GUI 显示 `status` 与 `summary`

### Requirement: Show Runtime Events
GUI SHALL 支持查看每个 session 的 runtime 事件（来自 `agents/<instance>/runtime/events.jsonl`），MVP 可展示最近 N 条并支持刷新。

#### Scenario: Show last N runtime events
- **GIVEN** `runtime/events.jsonl` 存在
- **WHEN** 用户打开 session 详情
- **THEN** GUI 展示最近 N 条事件

### Requirement: Workbench Tree for Task Directory
GUI SHALL provide a workbench tree view for a task that exposes a file-manager-like structure for:
- `shared/` (key anchors and shared artifacts)
- `agents/<instance>/` (session/runtime/artifacts)

Minimum nodes for MVP:
- `shared/state-board.md`
- `shared/human-notes.md`
- `shared/reports/`
- `shared/evidence/`
- `agents/<instance>/session.json`
- `agents/<instance>/runtime/` (events + stderr when present)
- `agents/<instance>/artifacts/` (final.json when present)

Selecting a tree node SHALL show a preview panel for that node's content (best-effort).

#### Scenario: Tree shows shared and agents roots
- **GIVEN** a task directory exists
- **WHEN** the user opens the Workbench (sessions) view
- **THEN** the tree includes `shared/` and `agents/` roots

#### Scenario: Tree shows minimal shared nodes
- **GIVEN** a task directory exists
- **WHEN** the user opens the Workbench (sessions) view
- **THEN** the tree includes `shared/state-board.md`, `shared/human-notes.md`, `shared/reports/`, and `shared/evidence/`

### Requirement: Runtime Viewer Panel
GUI SHALL provide a runtime viewer for a selected agent instance that can display:
- `runtime/events.jsonl` (session flow history; tail view at minimum)
- `runtime/stderr.log` (when present)
- `artifacts/final.json` (when present)

For `runtime/events.jsonl`, the viewer SHALL:
- display events ordered by time (best-effort; fall back to file order when no timestamp can be derived)
- support filtering (MVP: substring match is sufficient)

#### Scenario: View runtime events tail
- **GIVEN** `agents/<instance>/runtime/events.jsonl` exists
- **WHEN** the user selects the runtime events node
- **THEN** the GUI shows the last N lines and allows refresh

#### Scenario: Filter runtime events
- **GIVEN** the runtime events viewer is open
- **WHEN** the user enters a filter query
- **THEN** the GUI shows only matching events

### Requirement: Auto-Follow Active Session
GUI SHALL provide an auto-follow toggle for the sessions/workbench view.
When enabled, GUI SHALL automatically select the most recently updated session that is in `running` status (derived from artifacts/events rules).
When disabled, GUI SHALL not change the selected session automatically.

#### Scenario: Auto-follow selects running session
- **GIVEN** auto-follow is enabled and at least one session is running
- **WHEN** a running session becomes the most recently updated
- **THEN** the GUI selects that session in the list/tree

### Requirement: File Preview Panel (Markdown + HTML)
When a workbench node is a text file, GUI SHALL provide a read-only preview panel.
The preview panel SHALL:
- render `.md` as Markdown
- render `.html` as HTML (MVP: safe preview; scripts SHOULD NOT execute)
- render other text files as raw text

#### Scenario: Preview markdown file
- **GIVEN** a workbench node points to a `.md` file that exists
- **WHEN** the user selects the node
- **THEN** the GUI renders Markdown preview

#### Scenario: Preview HTML file
- **GIVEN** a workbench node points to a `.html` file that exists
- **WHEN** the user selects the node
- **THEN** the GUI renders HTML preview
