## 1. Implementation
- [x] Add dialog plugin dependency (frontend + tauri) and register it.
- [x] Add session-scoped repo selection state (current repo name + related repo paths, max 3).
- [x] Implement header UI: show repo names, hover tooltip with absolute path, hover-remove red "-".
- [x] Implement "+ add dir" button with directory picker and selection guards.
- [x] Implement Auto context message wrapper with repo header format.
- [x] Update GUI docs to describe the Auto context wrapper and repo selector behavior.

## 2. Validation
- [ ] Manual: select current session, add/remove related repos, verify UI limits.
- [ ] Manual: send message with Auto context on/off; verify outgoing text wrapper.
