# Change: Add GUI worktree switcher in Codex Chat

## Why
Users want to create and switch git worktrees directly in the GUI while keeping the current Codex thread active. They also need a clear footer indicator showing the active worktree and branch.

## What Changes
- Add a footer worktree label (worktree + branch) next to Auto context, with a menu to switch and create worktrees.
- Add backend commands to list worktrees, list local branches, and create a worktree at a sibling path.
- Allow switching worktrees without resetting the selected thread by applying cwd overrides on subsequent turns.
- Update GUI docs to describe worktree switching/creation behavior.

## Impact
- Affected specs: gui-codex-chat
- Affected code: apps/gui (frontend + Tauri backend)
- Docs: docs/agentmesh/gui.md
