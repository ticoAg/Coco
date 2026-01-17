## ADDED Requirements

### Requirement: Persisted Session Titles (Sidecar)
GUI SHALL support displaying a per-thread session title (`title`) in the Codex Chat session tree.

Because codex app-server `thread/list` primarily exposes `preview` (and does not provide a stable AI-generated title), the system SHALL persist a local sidecar title per workspace at:

- `<workspace_root>/.agentmesh/codex/threads/<thread_id>.json`

The sidecar MUST include:
- `title` (string)
- `source` (`generated-v1` or `manual`)
- `updatedAtMs` (number|null)

Title generation rules:
- If no sidecar exists, the system SHALL derive an auto title from `preview` by extracting the content after `## My request for Codex:` (or `## My request for Codex：`) when present; otherwise use `preview`.
- The auto title SHALL be normalized to a single line (whitespace-collapsed) and truncated to **max 25 Unicode characters**.
- When a manual title exists, it SHALL take precedence over auto-generated titles, and MAY be up to **max 50 Unicode characters**.

#### Scenario: Auto title is generated and persisted
- **GIVEN** a thread exists in `thread/list` with a non-empty `preview`
- **AND** no sidecar title exists for that `thread_id`
- **WHEN** the GUI loads the session list
- **THEN** the system generates an auto title (max 25 chars) and persists it to the workspace sidecar
- **AND** the session tree displays that title

#### Scenario: Manual title overrides auto title
- **GIVEN** a thread has an existing sidecar with `source = "manual"`
- **WHEN** the GUI loads the session list
- **THEN** the session tree displays the manual title (max 50 chars)

### Requirement: Task Node Context Menu (Rename / Delete)
GUI SHALL provide a context menu on session tree nodes of type `task` that supports:

- Rename: prompt for a new title, persist as `source="manual"` (max 50 chars), and refresh the session list.
- Delete: archive the selected task thread and its descendant threads by calling `thread/archive` per thread id, and remove any corresponding sidecar title files (best-effort).

#### Scenario: Rename a task node
- **GIVEN** the user right-clicks a `task` node
- **WHEN** the user selects "Rename" and enters a non-empty title
- **THEN** the system persists the title as manual (max 50 chars)
- **AND** the session tree updates to display the new title

#### Scenario: Delete archives task and descendants
- **GIVEN** the user right-clicks a `task` node that has child threads
- **WHEN** the user selects "Delete" and confirms
- **THEN** the system calls `thread/archive` for the task thread and each descendant thread
- **AND** the session list no longer shows those threads
