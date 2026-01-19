# Change: Align CodexChat conversation grouping with VSCode plugin

## Why
The current Coco GUI renders reasoning and tool activity differently from the VSCode Codex plugin, causing mismatched block grouping and titles for identical sessions.

## What Changes
- Add exploration-style grouping for read/search/list-files activities ("Exploring/Explored N files").
- Split reasoning summaries into multiple blocks while still showing reasoning content (keep current visibility).
- Align reading aggregation with plugin semantics (group consecutive reads into a single reading-files aggregate).

## Impact
- Affected specs: gui-codex-chat
- Affected code: apps/gui/src/components/CodexChat.tsx, apps/gui/src-tauri/src/codex_rollout_restore.rs
