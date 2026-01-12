## MODIFIED Requirements
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

## ADDED Requirements
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
