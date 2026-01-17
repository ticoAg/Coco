## ADDED Requirements

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
