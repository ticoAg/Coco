## ADDED Requirements

### Requirement: Workbench Tree for Task Directory
GUI SHALL provide a workbench tree view for a task that exposes a file-manager-like structure for:
- `shared/` (key anchors and shared artifacts)
- `agents/<instance>/` (session/runtime/artifacts)

Minimum nodes for MVP:
- `shared/state-board.md`
- `shared/human-notes.md`
- `shared/reports/`
- `shared/evidence/`
- `agents/<instance>/session.json`
- `agents/<instance>/runtime/` (events + stderr when present)
- `agents/<instance>/artifacts/` (final.json when present)

Selecting a tree node SHALL show a preview panel for that node's content (best-effort).

#### Scenario: Tree shows shared and agents roots
- **GIVEN** a task directory exists
- **WHEN** the user opens the Workbench (sessions) view
- **THEN** the tree includes `shared/` and `agents/` roots

#### Scenario: Tree shows minimal shared nodes
- **GIVEN** a task directory exists
- **WHEN** the user opens the Workbench (sessions) view
- **THEN** the tree includes `shared/state-board.md`, `shared/human-notes.md`, `shared/reports/`, and `shared/evidence/`

### Requirement: Runtime Viewer Panel
GUI SHALL provide a runtime viewer for a selected agent instance that can display:
- `runtime/events.jsonl` (session flow history; tail view at minimum)
- `runtime/stderr.log` (when present)
- `artifacts/final.json` (when present)

For `runtime/events.jsonl`, the viewer SHALL:
- display events ordered by time (best-effort; fall back to file order when no timestamp can be derived)
- support filtering (MVP: substring match is sufficient)

#### Scenario: View runtime events tail
- **GIVEN** `agents/<instance>/runtime/events.jsonl` exists
- **WHEN** the user selects the runtime events node
- **THEN** the GUI shows the last N lines and allows refresh

#### Scenario: Filter runtime events
- **GIVEN** the runtime events viewer is open
- **WHEN** the user enters a filter query
- **THEN** the GUI shows only matching events

### Requirement: Auto-Follow Active Session
GUI SHALL provide an auto-follow toggle for the sessions/workbench view.
When enabled, GUI SHALL automatically select the most recently updated session that is in `running` status (derived from artifacts/events rules).
When disabled, GUI SHALL not change the selected session automatically.

#### Scenario: Auto-follow selects running session
- **GIVEN** auto-follow is enabled and at least one session is running
- **WHEN** a running session becomes the most recently updated
- **THEN** the GUI selects that session in the list/tree

### Requirement: File Preview Panel (Markdown + HTML)
When a workbench node is a text file, GUI SHALL provide a read-only preview panel.
The preview panel SHALL:
- render `.md` as Markdown
- render `.html` as HTML (MVP: safe preview; scripts SHOULD NOT execute)
- render other text files as raw text

#### Scenario: Preview markdown file
- **GIVEN** a workbench node points to a `.md` file that exists
- **WHEN** the user selects the node
- **THEN** the GUI renders Markdown preview

#### Scenario: Preview HTML file
- **GIVEN** a workbench node points to a `.html` file that exists
- **WHEN** the user selects the node
- **THEN** the GUI renders HTML preview
