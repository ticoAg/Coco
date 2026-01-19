# Change: Add GUI Codex profile selector

## Why
Users need to switch Codex profiles for the current GUI session without editing `~/.codex/config.toml`, while preserving session history and aligning with CLI profile behavior.

## What Changes
- Add a profile selector in Codex Chat when config profiles exist.
- Load profiles from effective config; switching restarts the app-server with a profile override and resumes the current thread.
- Merge model options from `model/list` and profile-defined models; fall back to built-in models when empty.
- Prompt before switching when the focused turn is in progress.
- Update GUI and app-server API documentation.

## Impact
- Affected specs: `gui-codex-chat`
- Affected code:
  - [`apps/gui/src/components/CodexChat.tsx`](../../../../apps/gui/src/components/CodexChat.tsx)
  - `apps/gui/src/components/codex/StatusBar.tsx`
  - [`apps/gui/src/api/client.ts`](../../../../apps/gui/src/api/client.ts)
  - [`apps/gui/src-tauri/src/lib.rs`](../../../../apps/gui/src-tauri/src/lib.rs)
  - [`apps/gui/src-tauri/src/codex_app_server.rs`](../../../../apps/gui/src-tauri/src/codex_app_server.rs)
  - [`docs/coco/gui.md`](../../../../docs/coco/gui.md)
  - [`docs/implementation-notes/codex-cli/app-server-api.md`](../../../../docs/implementation-notes/codex-cli/app-server-api.md)
