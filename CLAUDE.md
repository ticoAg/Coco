# CLAUDE.md

This file provides guidance to AI coding agents (Claude Code, Codex CLI, etc.) when working in this repository.

## Project Overview

AgentMesh is a multi-agent orchestration framework. The current direction is:

- **macOS-only desktop app** via Tauri (`apps/gui/src-tauri`)
- **Rust orchestrator** as a CLI (`agentmesh`) that writes the task directory (`crates/*`)
- **React + Vite + Tailwind** frontend (`apps/gui`)

The previous Python implementation is archived under `legacy/python/`.

## Development Commands

```bash
# Install GUI deps
just gui deps

# Run dev app (Vite + Tauri)
just gui dev

# Build a release .app
just gui build

# Rust
just rust check
just rust test
just rust fmt
```

## Architecture Notes

- Task data is stored under `<workspace_root>/.agentmesh/tasks/<task_id>/...`
- The GUI is primarily read-only and visualizes the task directory (no local HTTP server)
- Orchestration is CLI-first: the main Codex session can call `agentmesh` to spawn parallel `codex exec --json` workers (see `docs/agentmesh/subagents.md`)
