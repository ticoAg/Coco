# gui-codex-chat Specification

## Purpose
定义 GUI 内的 Codex Chat 能力：通过 `codex app-server`（stdio JSON-RPC / JSONL）提供会话列表、turn/item 流式呈现与内联 approvals，并在不复刻 TUI 的前提下补齐模型/effort 选择、config 编辑、profile 选择与 Auto context 包装等富交互能力。
## Requirements
### Requirement: Codex Session List
GUI SHALL 读取 `~/.codex/sessions` 的会话索引（或通过 codex app-server `thread/list`）并按最近更新时间排序展示会话列表，至少显示会话 id 与最近一条摘要。

#### Scenario: List recent sessions
- **GIVEN** `~/.codex/sessions` 中存在多个会话记录
- **WHEN** 用户打开 Codex Chat 视图
- **THEN** GUI 按最近更新时间排序展示会话 id 与摘要

### Requirement: Start / Resume Thread via Codex
GUI SHALL 使用系统 PATH 中的 `codex` 启动会话，并支持按 thread id 恢复既有会话。

#### Scenario: Resume existing thread
- **GIVEN** 用户选择列表中的一个 thread id
- **WHEN** 用户点击进入会话
- **THEN** GUI 通过 codex 接口恢复该 thread 并继续对话

### Requirement: Streaming Turn Events
GUI SHALL 流式呈现 turn 的 item 事件（agent message、reasoning、command execution、file change、mcp tool call、web_search、error），并以消息流形式展示。

#### Scenario: Stream items while running
- **GIVEN** 用户发送一条消息
- **WHEN** codex 产生 item 事件
- **THEN** GUI 逐条追加到消息流并更新对应状态

#### Scenario: Hide placeholder when assistant streams JSON
- **GIVEN** assistant-message 正在 streaming 且内容以 `{` 或 ``` 开头
- **WHEN** GUI 接收到该条消息内容
- **THEN** GUI 以 placeholder 方式展示而不直接渲染正文内容

### Requirement: Inline Approvals
当 codex 请求命令/文件变更审批时，GUI SHALL 以会话消息形式展示批准/拒绝选项，并将用户选择回传给 codex。

#### Scenario: Approve command request
- **GIVEN** codex 请求执行一条命令
- **WHEN** 用户点击“批准”
- **THEN** GUI 向 codex 发送批准响应并继续 turn

### Requirement: Model & Reasoning Effort Selection
GUI 输入区 SHALL 提供 `model` 与 `model_reasoning_effort` 下拉选项，并在发送 turn 时作为覆盖参数传给 codex；未选择时使用默认配置。
Model dropdown options SHALL be derived from `model/list`. When config profiles exist, GUI SHALL union the `model/list` options with all profile-defined `model` values (string or array), and de-duplicate.
If the resulting model list is empty, GUI SHALL fall back to `gpt-5.2` and `gpt-5.2-codex`.

#### Scenario: Override model on turn
- **GIVEN** 用户选择 `model` 与 `model_reasoning_effort`
- **WHEN** 用户发送消息
- **THEN** 该 turn 使用选择的参数运行

#### Scenario: Merge profile models into model dropdown
- **GIVEN** config profiles define one or more `model` values
- **WHEN** the GUI loads model options
- **THEN** the model dropdown includes the union of `model/list` and profile models

#### Scenario: Fallback model list when empty
- **GIVEN** no models are returned and no profile models are defined
- **WHEN** the GUI loads model options
- **THEN** the model dropdown shows `gpt-5.2` and `gpt-5.2-codex`

### Requirement: Config Editor Panel
GUI SHALL 通过面板读取并编辑 `~/.codex/config.toml`，保存后写回同路径；路径需按平台 HOME 目录解析。

#### Scenario: Edit config.toml
- **GIVEN** 用户打开配置面板
- **WHEN** 用户修改并保存 `~/.codex/config.toml`
- **THEN** 文件内容被更新且下次会话使用新配置

### Requirement: Assistant Message Grouping
GUI SHALL 将 turn 内最后一条 assistant-message 作为最终回复展示，其余 assistant-message 保持在 Working 区域中。

#### Scenario: Only last assistant-message is final reply
- **GIVEN** 一个 turn 中存在多条 assistant-message
- **WHEN** GUI 分组渲染该 turn
- **THEN** 仅最后一条 assistant-message 渲染为最终回复，其余仍在 Working 区域

### Requirement: Code Review Structured Output Rendering
当 assistant-message 内容为 Code Review JSON 且解析成功时，GUI SHALL 渲染 Findings 卡片与优先级标签，并以与 Codex VSCode plugin 等效的内容结构展示。

#### Scenario: Render structured Code Review output
- **GIVEN** assistant-message 内容是 Code Review JSON
- **WHEN** GUI 解析结构化输出成功
- **THEN** GUI 渲染 Findings 卡片与优先级信息

### Requirement: Stream/System Error Display
GUI SHALL 将 stream-error 与 system-error 类型消息作为 Working 区域的可见条目渲染。

#### Scenario: Show stream error with details
- **GIVEN** 系统返回 error 且包含重试或详细信息
- **WHEN** GUI 显示该条 error
- **THEN** GUI 在 Working 区域渲染 stream-error 详情

### Requirement: Codex Session Running Indicator
GUI SHALL 在 Codex 会话列表中显示“运行中”指示，当 thread 存在进行中的 turn。
GUI SHALL 在加载会话列表时调用 `thread/loaded/list` 作为运行中指示的初始种子，并在收到 `turn/started` 与 `turn/completed` 通知时更新该指示。

#### Scenario: Mark running session from turn lifecycle
- **GIVEN** 会话列表已显示
- **WHEN** GUI 收到某 thread 的 `turn/started`
- **THEN** 该会话显示运行中指示，直到收到同 thread 的 `turn/completed`

#### Scenario: Seed running sessions on load
- **GIVEN** GUI 加载会话列表
- **WHEN** `thread/loaded/list` 返回若干 thread id
- **THEN** 这些会话显示运行中指示

### Requirement: Exploration Grouping for Tooling Activity
GUI SHALL group contiguous `read`, `search`, and `list_files` activities (including aggregated reading-files) together with adjacent reasoning into an Exploration block in the Working area.
GUI SHALL label the Exploration block as "Exploring" while the turn is in progress, and "Explored" once complete, including the unique file count when available.

#### Scenario: Exploration grouping in progress
- **GIVEN** a turn contains consecutive `list_files`/`search`/`read` activities and reasoning
- **WHEN** the turn is still in progress
- **THEN** GUI shows a single Exploration block titled "Exploring" with nested items and a unique file count

#### Scenario: Exploration grouping completed
- **GIVEN** a turn contains consecutive `list_files`/`search`/`read` activities and reasoning
- **WHEN** the turn finishes
- **THEN** GUI shows the same group titled "Explored" and preserves the nested items

### Requirement: Reasoning Summary Segmentation with Content
GUI SHALL render each reasoning summary entry as its own reasoning block while also displaying reasoning content when present.
GUI SHALL preserve reasoning content visibility even when summaries are segmented.

#### Scenario: Reasoning summary produces multiple blocks
- **GIVEN** a reasoning item includes multiple summary entries and content
- **WHEN** GUI renders the Working area
- **THEN** GUI renders multiple reasoning blocks (one per summary entry) and still displays the reasoning content

#### Scenario: Reasoning content without summary
- **GIVEN** a reasoning item has no summary entries but includes content
- **WHEN** GUI renders the Working area
- **THEN** GUI renders a single reasoning block showing the content

### Requirement: Auto Context Repo Selector
GUI SHALL provide a header repo selector that:
- shows the current repo name (when available),
- lists up to 3 related repo names,
- allows adding related repos via a directory picker,
- allows removing a related repo via a hover-only red "-" affordance,
- shows absolute paths only on hover (not in the main label).

#### Scenario: Add related repo
- **GIVEN** a GUI session with a current repo path available
- **WHEN** the user clicks "+ add dir" and selects a directory
- **THEN** the related repo name appears in the header and the absolute path is shown on hover

#### Scenario: Related repo limit
- **GIVEN** three related repos are already selected
- **WHEN** the user views the header
- **THEN** the "+ add dir" button is not shown

#### Scenario: Remove related repo
- **GIVEN** a related repo is listed
- **WHEN** the user hovers the repo name and clicks the red "-"
- **THEN** the repo is removed from the related list

#### Scenario: No current repo
- **GIVEN** no current repo is available (no active thread)
- **WHEN** the header renders
- **THEN** the current repo label is not shown

### Requirement: Auto Context Message Wrapper
When Auto context is enabled, GUI SHALL wrap the outgoing user message as:

#### Scenario: Wrap with current + related repos
- **GIVEN** Auto context is enabled with a current repo and two related repos
- **WHEN** the user sends a message
- **THEN** the outgoing text includes the header with current and two related repo lines

#### Scenario: Auto context disabled
- **GIVEN** Auto context is disabled
- **WHEN** the user sends a message
- **THEN** the outgoing text is the raw user input without a wrapper

Format example:

```
# Context from my IDE setup:

### Requirement: Config Profile Selection
GUI SHALL show a profile selector in Codex Chat when `config.profiles` is non-empty.
Selecting a profile SHALL update the active profile for the current GUI session only (no config file write), restart the codex app-server with that profile, and resume the currently selected thread to preserve history.
If the currently focused turn is in progress, GUI SHALL ask for confirmation before switching; declining leaves the profile unchanged.

#### Scenario: Profiles present show selector
- **GIVEN** config profiles exist
- **WHEN** the user opens Codex Chat
- **THEN** the GUI shows a profile selector listing profile names

#### Scenario: Switch profile resumes thread
- **GIVEN** a selected thread exists and is not running
- **WHEN** the user selects a different profile
- **THEN** the GUI restarts the app-server with that profile and resumes the current thread

#### Scenario: Confirm switch during running turn
- **GIVEN** the focused turn is in progress
- **WHEN** the user selects a different profile
- **THEN** the GUI prompts for confirmation and only switches after confirmation

### Requirement: Fork Current Thread
GUI SHALL 提供 fork 操作：从当前选中的 Codex thread 派生一个新的 thread，并将新 thread 作为当前会话打开。

fork 操作 SHOULD 在以下条件下可用：
- 当前存在已选择的 thread
- 当前 thread 没有进行中的 turn（若有，GUI SHALL 提示确认或禁用操作）

#### Scenario: Fork creates a new thread and opens it
- **GIVEN** 当前已选择一个 thread 且 turn 不在进行中
- **WHEN** 用户点击 Fork
- **THEN** GUI 调用 `thread/fork`
- **AND** GUI 打开返回的新 thread

### Requirement: Rollback Last Turns
GUI SHALL 提供 rollback 操作，用于回退当前 thread 最近的 N 个 turns 的历史（MVP：N=1）。

GUI MUST 明确提示：rollback 仅影响会话历史，不回滚本地文件修改。

#### Scenario: Rollback last turn updates history
- **GIVEN** 当前 thread 至少有 1 个已完成的 turn
- **WHEN** 用户执行 rollback（N=1）并确认
- **THEN** GUI 调用 `thread/rollback`（或等价语义）
- **AND** GUI 刷新当前会话历史

### Requirement: Prevent Rollback During Running Turn
当当前 thread 存在进行中的 turn 时，GUI SHALL 在执行 rollback 前请求用户确认；若用户取消，则不执行 rollback。

#### Scenario: Confirm rollback during running turn
- **GIVEN** 当前 thread 的 turn 正在进行中
- **WHEN** 用户点击 rollback
- **THEN** GUI 弹出确认提示
- **AND** 仅当用户确认时才发起 rollback

