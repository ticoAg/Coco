# Tasks: add-07-gui-shared-artifacts

## 1. Implementation
- [x] 1.1 Add Tauri commands to list and read shared artifacts (reports/contracts/decisions) with path validation.
- [x] 1.2 Add GUI types + API client calls for shared artifacts listing and content.
- [x] 1.3 Add hooks with polling refresh for artifacts while Artifacts tab is active.
- [x] 1.4 Add Artifacts tab UI with subcategory selector, list, and Markdown preview.
- [x] 1.5 Add Markdown rendering dependency and fallback rendering for non-markdown files.

## 2. Validation
- [x] openspec validate add-07-gui-shared-artifacts --strict
- [x] npm -C apps/gui run build
