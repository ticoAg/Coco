# Change: Add running indicator for Codex sessions

## Why
Users need to see which Codex session is actively running a turn without opening each session.

## What Changes
- Add a running indicator (spinner) in the Codex session list.
- Track running thread ids from turn lifecycle notifications and a one-time `thread/loaded/list` seed query.
- Expose a Tauri command + GUI client method for `thread/loaded/list`.

## Impact
- Affected specs: gui-codex-chat
- Affected code: apps/gui/src/components/CodexChat.tsx, apps/gui/src/api/client.ts, apps/gui/src/types/codex.ts, apps/gui/src-tauri/src/lib.rs
