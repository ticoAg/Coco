## ADDED Requirements

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
