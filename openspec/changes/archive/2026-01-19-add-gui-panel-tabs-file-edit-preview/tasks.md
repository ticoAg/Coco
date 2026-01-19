## 1. Implementation
- [x] Add tauri backend command `workspace_write_file` with safe path + size limits
- [x] Add frontend API client wrapper for `workspace_write_file`
- [x] Extend Codex Chat tabs to support multiple `agent` panels and multiple `file` panels
- [x] Implement file panel edit + save + (eye toggled) preview sidebar
- [x] Add dirty-close confirmation for file panels

## 2. Validation
- [x] `cd apps/gui && npm run typecheck && npm run lint && npm run build`
- [x] `cd apps/gui/src-tauri && cargo fmt --check && cargo test` (or `cargo check`)
