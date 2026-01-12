# gui-codex-chat Specification

## Purpose
TBD - created by archiving change add-gui-codex-chat-core. Update Purpose after archive.
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

#### Scenario: Override model on turn
- **GIVEN** 用户选择 `model` 与 `model_reasoning_effort`
- **WHEN** 用户发送消息
- **THEN** 该 turn 使用选择的参数运行

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

