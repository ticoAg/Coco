# Development (Rust-first + Tauri macOS)

AgentMesh is moving to a macOS-only `.app` distribution built with Tauri, with a CLI-first orchestrator:

- **Orchestrator (control plane)**: Rust CLI (`agentmesh`) that spawns/resumes/cancels workers and writes `.agentmesh/tasks/*`
- **GUI (read-only)**: Tauri app that visualizes the task directory (no local HTTP server)
- **Frontend**: React + Vite + Tailwind (inside the GUI)

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
