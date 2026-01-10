# Development (Rust-first + Tauri macOS)

AgentMesh is moving to a macOS-only `.app` distribution built with Tauri, with an embedded orchestrator and an optional CLI wrapper:

- **Orchestrator (control plane)**: Rust library (`agentmesh-orchestrator`) embedded in the Tauri backend; optional `agentmesh` CLI wrapper for scripts/automation.
- **GUI (primary entry)**: Tauri app that visualizes the task directory (no local HTTP server).
- **Frontend**: React + Vite + Tailwind (inside the GUI).

Note: the `agentmesh` CLI is optional; the current implementation is an MVP focused on tasks/events (`agentmesh task create|list|show|events` + `--json`).
Worker lifecycle commands (spawn/resume/cancel/join) are planned and tracked in follow-up OpenSpec changes.

The previous Python implementation is archived under `legacy/python/`.

## Prerequisites

- Rust toolchain (stable)
- Node.js + npm
- macOS build tools (Xcode Command Line Tools)
- `codex` installed and available on `PATH` (required only when running workers)

## Common commands

```bash
# Install GUI deps
just gui deps

# Run the app in dev mode (Vite + Tauri)
just gui dev

# Build a release `.app`
just gui build

# Rust checks
just rust check
```

## Workspace root (tasks)

In dev mode, the Tauri app automatically uses the repository root if it contains `.agentmesh/`.

To override, set:

```bash
export AGENTMESH_WORKSPACE_ROOT="/path/to/workspace"
```

The `agentmesh` CLI uses the same workspace root resolution rules as the GUI/Tauri app.
