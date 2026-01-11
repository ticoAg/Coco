# Change: Add GUI Auto Context Repo Selector & Message Wrapper

## Why
Users want a lightweight Auto context flow in the GUI that only wraps the outgoing message with repo paths, plus a clear UX to pick related repositories without fully replicating VSCode plugin behavior.

## What Changes
- Add a repo selector UI in the GUI header: show current repo name, list related repo names, and allow adding/removing up to 3 related repos.
- When Auto context is enabled, wrap each outgoing user message using a fixed header format that includes current/related repo paths.
- Use a native directory picker for adding related repos, and show full absolute paths on hover only.
- Session-scoped only: selections reset for new sessions (no cross-session persistence).

## Impact
- Affected specs: `gui-codex-chat` (new requirements for repo selector + message wrapping).
- Affected code: `apps/gui/src/components/CodexChat.tsx`, `apps/gui/src-tauri/src/lib.rs`, `apps/gui/src-tauri/Cargo.toml`, `apps/gui/package.json` (dialog plugin).
- Docs: update `docs/agentmesh/gui.md` to reflect Auto context wrapper UX and repo selector behavior.
