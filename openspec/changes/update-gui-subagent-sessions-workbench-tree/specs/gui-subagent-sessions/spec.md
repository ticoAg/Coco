## ADDED Requirements

### Requirement: Workbench Tree for Task Directory
GUI SHALL provide a workbench tree view for a task that exposes a file-manager-like structure for:
- `shared/` (key anchors and shared artifacts)
- `agents/<instance>/` (session/runtime/artifacts)

Selecting a tree node SHALL show a preview panel for that node's content (best-effort).

#### Scenario: Tree shows shared and agents roots
- **GIVEN** a task directory exists
- **WHEN** the user opens the Workbench (sessions) view
- **THEN** the tree includes `shared/` and `agents/` roots

### Requirement: Runtime Viewer Panel
GUI SHALL provide a runtime viewer for a selected agent instance that can display:
- `runtime/events.jsonl` (tail view at minimum)
- `runtime/stderr.log` (when present)
- `artifacts/final.json` (when present)

#### Scenario: View runtime events tail
- **GIVEN** `agents/<instance>/runtime/events.jsonl` exists
- **WHEN** the user selects the runtime events node
- **THEN** the GUI shows the last N lines and allows refresh

### Requirement: Auto-Follow Active Session
GUI SHALL provide an auto-follow toggle for the sessions/workbench view.
When enabled, GUI SHALL automatically select the most recently updated session that is in `running` status (derived from artifacts/events rules).
When disabled, GUI SHALL not change the selected session automatically.

#### Scenario: Auto-follow selects running session
- **GIVEN** auto-follow is enabled and at least one session is running
- **WHEN** a running session becomes the most recently updated
- **THEN** the GUI selects that session in the list/tree

