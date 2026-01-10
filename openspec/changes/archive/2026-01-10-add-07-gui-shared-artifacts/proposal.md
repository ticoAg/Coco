# Change: Add GUI shared artifacts view (Reports/Contracts/Decisions)

## Why
The GUI currently exposes task overview, events, and subagent sessions but does not surface shared artifacts. This change adds a read-only artifacts view that aligns the GUI with the artifacts-first workflow described in docs.

## What Changes
- Add Tauri IPC commands to list and read shared artifacts from the task directory.
- Add an Artifacts tab with subcategories (Reports / Contracts / Decisions), Markdown rendering, and polling refresh.
- Add frontend types/hooks to support artifacts listing and preview.

## Impact
- Affected specs: gui-artifacts (new)
- Affected code: apps/gui/src-tauri/src/lib.rs, apps/gui/src/api/client.ts, apps/gui/src/hooks/useTasks.ts, apps/gui/src/components/TaskDetail.tsx, apps/gui/src/types/task.ts, apps/gui/package.json
