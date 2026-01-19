# gui-codex-chat (delta)

## ADDED Requirements

### Requirement: Multi-Panel Tabs (Agent/File)
GUI SHALL support opening multiple panels within one window via tabs:
- `agent` panel tabs are bound to a Codex `threadId` and render that thread's chat timeline.
- `file` panel tabs are bound to a workspace-relative file path and render an editor (default) with an optional preview sidebar.

#### Scenario: Click session tree node opens/focuses agent panel
- **GIVEN** the left session tree shows a task/orchestrator/worker node with a `threadId`
- **WHEN** the user clicks the node
- **THEN** the GUI opens a new agent tab for that `threadId` if missing, otherwise focuses the existing tab
- **AND** the agent panel shows the selected thread's timeline

#### Scenario: Multiple panels can be open simultaneously
- **GIVEN** the user opens two agent tabs and two file tabs
- **WHEN** the user switches between tabs
- **THEN** each tab remains available within the same window and can be closed independently

### Requirement: File Edit + Eye-Toggled Preview
When a file tab is opened, GUI SHALL:
- show an editor view by default,
- provide an "eye" icon in the panel header that toggles a preview sidebar,
- render Markdown preview for `.md`, HTML preview for `.html/.htm` (sandboxed), and raw text otherwise.

#### Scenario: Toggle preview sidebar
- **GIVEN** a file tab is open
- **WHEN** the user clicks the "eye" icon
- **THEN** the preview sidebar opens/closes within the same file panel

### Requirement: Safe File Save (Workspace-Scoped)
GUI SHALL support saving edited file content back to disk with workspace-scoped safety constraints:
- the write MUST be scoped to the current `workspaceBasePath(cwd)` plus a workspace-relative path,
- absolute paths and path traversal attempts MUST be rejected,
- content size MUST be limited (MVP: 1MB),
- only existing regular files are supported (MVP).

#### Scenario: Save edits to an existing file
- **GIVEN** a file tab is open and the editor content is modified
- **WHEN** the user clicks Save
- **THEN** the GUI writes the updated content to disk under the workspace root and clears the dirty state

#### Scenario: Prevent writing outside workspace
- **GIVEN** a write request attempts to escape the workspace (absolute path, `..`, or symlink out)
- **WHEN** the user clicks Save
- **THEN** the backend rejects the request and the GUI shows an error

### Requirement: Dirty Close Confirmation (File Tabs)
GUI SHALL prompt for confirmation when the user closes a file tab that has unsaved edits.

#### Scenario: Confirm before closing dirty file tab
- **GIVEN** a file tab has unsaved edits (dirty)
- **WHEN** the user closes the tab
- **THEN** the GUI asks for confirmation and cancels close if the user declines

