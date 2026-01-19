## ADDED Requirements

### Requirement: Worktree Status and Switcher
GUI SHALL display the active worktree and git branch next to the Auto context control in the Codex Chat footer. GUI SHALL update the label when the active worktree changes.

#### Scenario: Show worktree + branch
- **GIVEN** an active worktree path and branch are available
- **WHEN** the Codex Chat footer renders
- **THEN** the UI shows a label with the worktree name and branch

### Requirement: Switch Worktree Without Resetting Thread
GUI SHALL allow switching the active worktree from a list of git worktrees. Switching SHALL keep the current thread selected and apply the new worktree cwd on subsequent turns via a `turn/start` cwd override that persists for the thread.

#### Scenario: Switch worktree keeps thread
- **GIVEN** a selected thread and an alternative worktree in the list
- **WHEN** the user selects that worktree
- **THEN** the current thread remains selected
- **AND** subsequent turns use the selected worktree cwd

### Requirement: Create Worktree From Existing Branch
GUI SHALL allow creating a new worktree by choosing an existing local branch and a worktree name. The default worktree path SHALL be a sibling directory of the current repo.

#### Scenario: Create worktree with existing branch
- **GIVEN** an existing local branch is selected and a worktree name is provided
- **WHEN** the user confirms create worktree
- **THEN** GUI creates a new worktree at a sibling path and sets it as active
