# Development (Rust-first + Tauri macOS)

Coco is moving to a macOS-only `.app` distribution built with Tauri, with an embedded orchestrator and an optional CLI wrapper:

- **Orchestrator (control plane)**: Rust library (`coco-orchestrator`) embedded in the Tauri backend; optional `coco` CLI wrapper for scripts/automation.
- **GUI (primary entry)**: Tauri app that visualizes the task directory (no local HTTP server).
- **Frontend**: React + Vite + Tailwind (inside the GUI).

Note: the `coco` CLI is optional; the current implementation is an MVP focused on tasks/events (`coco task create|list|show|events` + `--json`).
Worker lifecycle commands (spawn/resume/cancel/join) are planned and tracked in follow-up OpenSpec changes.

The previous Python implementation is archived under [`legacy/python/`](legacy/python).

## Prerequisites

- Rust toolchain (stable)
- Node.js + npm
- macOS build tools (Xcode Command Line Tools)
- Ubuntu (optional): Tauri system deps (installed by `just deps`, requires `sudo apt-get update/install`)
- `codex` installed and available on `PATH` (required for Codex Chat and when running workers)
  - macOS: if launching the `.app` from Finder, you may need to set `COCO_CODEX_BIN=/opt/homebrew/bin/codex` because GUI apps don't always inherit your shell `PATH`.

## Common commands

```bash
# Install GUI deps (optional; `just dev` will auto-install when needed)
just deps

# Ubuntu only: `just deps` will also install system deps via apt-get (sudo required)

# Run the app in dev mode (Vite + Tauri)
just dev

# Build a release `.app`
just build

# Rust checks
just check

# Full-stack quality checks (frontend + backend)
just fmt
just fmt-check
just lint
just test

# Frontend-only / Backend-only
just fe-check
just fe-fmt
just fe-fmt-check
just fe-lint
just fe-build
just be-check
just be-fmt
just be-fmt-check
just be-lint
just be-test
just be-build
```

## Release (macOS DMG)

See [`docs/coco/release.md`](docs/coco/release.md) for the tag-driven GitHub Actions release workflow and local DMG build commands.

## Workspace root (tasks)

In dev mode, the Tauri app automatically uses the repository root if it contains [`.coco/`](.coco).

To override, set:

```bash
export COCO_WORKSPACE_ROOT="/path/to/workspace"
```

The `coco` CLI uses the same workspace root resolution rules as the GUI/Tauri app.
