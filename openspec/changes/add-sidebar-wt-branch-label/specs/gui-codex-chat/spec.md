## ADDED Requirements

### Requirement: Session Tree Shows Worktree Branch Label
GUI SHALL display a worktree/branch label for each Codex session node (`task`, `orchestrator`, `worker`) in the left session tree.
The label MUST be formatted as `wt-[branch]`, where `branch` is derived from the thread `cwd` matched against `git worktree list` results.

If the branch cannot be determined, the GUI MUST display `wt-[unknown]`.
If the thread is on a detached HEAD, the GUI MUST display `wt-[detached]`.

For long branch names, the label MUST be truncated in the UI and the full label MUST be available via tooltip.

#### Scenario: Show worktree label for session node
- **GIVEN** the session tree renders a `worker` node for a thread with a `cwd`
- **AND** the system resolves the worktree branch name
- **WHEN** the session tree row is rendered
- **THEN** the GUI shows a suffix `wt-[branch]` next to the node title

#### Scenario: Truncate long branch name with tooltip
- **GIVEN** the branch name is long
- **WHEN** the session tree row is rendered
- **THEN** the UI truncates the displayed label
- **AND** hovering the label shows the full `wt-[branch]`

#### Scenario: Fallback when branch cannot be resolved
- **GIVEN** the thread `cwd` exists but the branch cannot be resolved
- **WHEN** the session tree row is rendered
- **THEN** the GUI shows `wt-[unknown]`

#### Scenario: Detached HEAD label
- **GIVEN** the thread `cwd` matches a worktree that is detached
- **WHEN** the session tree row is rendered
- **THEN** the GUI shows `wt-[detached]`
