## ADDED Requirements
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
