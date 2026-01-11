# gui-codex-chat Specification (Delta)

## MODIFIED Requirements
### Requirement: Model & Reasoning Effort Selection
GUI 在 Footer Status Bar 内 SHALL 提供独立的下拉入口用于配置 `model`、`approval_policy` 与 `model_reasoning_effort`；选择后应立即生效，并同步写入 `~/.codex/config.toml` 对应配置项；发送 turn 时可作为覆盖参数传给 codex。

#### Scenario: Override config via status bar dropdown and persist
- **GIVEN** 用户通过 Footer Status Bar 打开配置下拉菜单
- **WHEN** 用户选择新的 `model` / `approval_policy` / `model_reasoning_effort`
- **THEN** GUI 立即在后续 turn 中使用新选择并将其写入 `~/.codex/config.toml`

## ADDED Requirements
### Requirement: Footer Status Bar
GUI SHALL 提供固定在底部的 Footer Status Bar，用于承载输入区工具入口与运行/配置指示器（例如 `+`、`Auto context`、`对话设置`、Local/Custom/Model/Reasoning）。

#### Scenario: Use footer status bar controls
- **GIVEN** 用户处于 Codex Chat 视图
- **WHEN** 用户点击 Footer 内的 `+`/`Auto context`/`对话设置`
- **THEN** 对应功能在不遮挡主消息流的前提下完成交互

### Requirement: Context Usage Indicator
GUI SHALL 在 Footer 右下角展示上下文用量（token usage），格式为：`上下文 {percent}% · {used}/{window}`；当 `window` 不可用时至少展示 `{used}`。

#### Scenario: Show token usage while chatting
- **GIVEN** codex 发送 `thread/tokenUsage/updated` 通知
- **WHEN** GUI 收到该通知
- **THEN** Footer 右下角更新显示对应的上下文用量信息
