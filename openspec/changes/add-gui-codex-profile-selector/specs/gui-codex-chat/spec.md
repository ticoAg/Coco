## ADDED Requirements
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

## MODIFIED Requirements
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
