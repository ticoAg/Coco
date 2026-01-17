## ADDED Requirements

### Requirement: Render Collab Agent Tool Calls
GUI SHALL render `CollabAgentToolCall` items (`type: "collabAgentToolCall"`) in the Codex Chat working area, including:
- `tool` (e.g. `spawnAgent`, `sendInput`, `wait`, `closeAgent`)
- `status`
- `senderThreadId`
- `receiverThreadIds`
- `agentsStates` (when present)
- `prompt` (when present)

#### Scenario: Show spawnAgent call in working area
- **GIVEN** a turn produces an item of type `collabAgentToolCall`
- **WHEN** the GUI renders the working area
- **THEN** the GUI shows a Collab tool call block with `tool`/`status`/`senderThreadId`/`receiverThreadIds`

### Requirement: Collab Workbench (Thread Tree + Multi-Panel)
When collab tool calls are present, GUI SHALL provide a workbench mode that:
- builds a thread graph from collab tool calls (root thread → orchestrator thread → worker threads),
- shows the graph as a thread tree,
- supports a multi-panel layout with an orchestrator panel pinned and worker panels switchable.

#### Scenario: Workbench infers orchestrator thread
- **GIVEN** a root thread (no incoming `spawnAgent` edge in the current graph) produces a `collabAgentToolCall` with `tool: "spawnAgent"`
- **WHEN** the tool call completes with a new `receiverThreadIds[0]`
- **THEN** the GUI marks that `receiverThreadIds[0]` thread as the orchestrator node in the thread tree (fallback rule)

#### Scenario: Workbench lists worker threads
- **GIVEN** the orchestrator thread produces multiple `collabAgentToolCall` items with `tool: "spawnAgent"`
- **WHEN** those calls complete with new `receiverThreadIds` values
- **THEN** the GUI lists those threads as worker nodes under the orchestrator node

### Requirement: Auto-Focus Active Agent Panel
GUI SHALL provide an Auto-focus toggle. When enabled, GUI SHALL automatically focus the panel for the agent/thread that is currently running (best-effort), based on:
- collab agent states, and/or
- `turn/started` / `turn/completed` notifications.

When disabled, GUI SHALL not auto-switch panels.

#### Scenario: Auto-focus switches to running worker
- **GIVEN** auto-focus is enabled and a worker thread becomes running
- **WHEN** the GUI receives an update indicating the worker is running
- **THEN** the GUI focuses that worker panel

### Requirement: Fork Any Workbench Thread
In workbench mode, GUI SHALL allow the user to fork the currently focused thread, and SHALL update the thread tree to include the new forked thread as a child node.

#### Scenario: Fork creates a branch in the thread tree
- **GIVEN** a workbench thread is focused
- **WHEN** the user clicks fork and the backend returns a new thread id
- **THEN** the GUI shows the new thread as a child branch and opens it
