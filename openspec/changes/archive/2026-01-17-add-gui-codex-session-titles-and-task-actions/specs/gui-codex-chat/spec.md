## ADDED Requirements

### Requirement: Persisted Session Titles (Sidecar)
GUI SHALL support displaying a per-thread session title (`title`) in the Codex Chat session tree.

Because codex app-server `thread/list` primarily exposes `preview` (and does not provide a stable AI-generated title), the system SHALL persist a local sidecar title per workspace at:

- `<workspace_root>/.coco/codex/threads/<thread_id>.json`

The sidecar MUST include:
- `title` (string)
- `source` (`manual`)
- `updatedAtMs` (number|null)

Title generation rules:
- If no manual sidecar exists, the system SHALL derive an auto title from `preview` by extracting the content after `## My request for Codex:` (or `## My request for Codex：`) when present; otherwise use `preview`.
- The auto title SHALL be normalized to a single line (whitespace-collapsed) and truncated to **max 50 units**, where:
  - CJK characters count as 1 unit each (including CJK punctuation),
  - English (and other non-CJK) segments are counted by whitespace-separated **words** (punctuation remains part of the word and still counts as 1).
- When a manual title exists, it SHALL take precedence over auto-generated titles, and MAY be up to **max 50 Unicode characters**.

#### Scenario: Auto title is generated and persisted
- **GIVEN** a thread exists in `thread/list` with a non-empty `preview`
- **AND** no manual sidecar exists for that `thread_id`
- **WHEN** the GUI loads the session list
- **THEN** the system generates an auto title (max 50 chars) from `preview`
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

### Requirement: Active vs Archived Session Grouping
GUI SHALL group Codex sessions into **Active** and **Archived** buckets based on last activity time:

- A session is **Archived** when `now - updatedAtMs > 1h` (regardless of sender).
- Otherwise it is **Active**.
- For task nodes, the `updatedAtMs` used for grouping SHALL be the most recent `updatedAtMs` across the task thread and its descendant threads (orchestrator + workers).
- If an archived task receives an update within the last **3 minutes**, it SHALL appear under **Active**.

Archived sessions SHALL be grouped by date/hour using a two-level tree:
- `YYYY-MM-DD` (first level)
- `HH` (second level)

#### Scenario: Group sessions by activity
- **GIVEN** sessions with mixed `updatedAtMs`
- **WHEN** the session tree renders
- **THEN** sessions are split into Active and Archived
- **AND** Archived sessions are grouped by `YYYY-MM-DD` then `HH`

#### Scenario: Task revives when a descendant updates
- **GIVEN** a task whose root thread is older than 1 hour
- **AND** one of its worker threads updates within the last 3 minutes
- **WHEN** the session tree renders
- **THEN** the task appears under Active

### Requirement: Batch Archive by Group
GUI SHALL provide a hover-only archive affordance on each `HH` group node.
Clicking the affordance SHALL archive all sessions in that group via `thread/archive`, then refresh the list.

#### Scenario: Archive a group
- **GIVEN** a `HH` group node with N sessions
- **WHEN** the user clicks the archive affordance and confirms
- **THEN** the GUI calls `thread/archive` for all N sessions
- **AND** refreshes the session list after completion

### Requirement: Recent Session Auto-Refresh Window
When a refresh completes, if any session has `updatedAtMs` within the last 30 seconds, GUI SHALL start a 30-second auto-refresh window that re-fetches the session list every 7 seconds.

#### Scenario: Start a 3-minute refresh window
- **GIVEN** a refresh returns at least one session updated within 30 seconds
- **WHEN** the refresh completes
- **THEN** GUI auto-refreshes the session list every 7 seconds for the next 30 seconds

### Requirement: Restore Recently Updated Archived Sessions
The GUI backend SHALL restore archived sessions when their archived rollouts are updated recently:

- If a rollout file under `~/.codex/archived_sessions` is modified within the last **3 minutes**, the system SHALL move it back to `~/.codex/sessions` before listing threads.

#### Scenario: Restore archived session on recent update
- **GIVEN** a rollout file exists under `~/.codex/archived_sessions`
- **AND** the file modification time is within the last 3 minutes
- **WHEN** the GUI requests the session list
- **THEN** the rollout is moved back under `~/.codex/sessions`
- **AND** the session appears in the list
