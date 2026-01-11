## ADDED Requirements

### Requirement: Auto Context Repo Selector
GUI SHALL provide a header repo selector that:
- shows the current repo name (when available),
- lists up to 3 related repo names,
- allows adding related repos via a directory picker,
- allows removing a related repo via a hover-only red "-" affordance,
- shows absolute paths only on hover (not in the main label).

#### Scenario: Add related repo
- **GIVEN** a GUI session with a current repo path available
- **WHEN** the user clicks "+ add dir" and selects a directory
- **THEN** the related repo name appears in the header and the absolute path is shown on hover

#### Scenario: Related repo limit
- **GIVEN** three related repos are already selected
- **WHEN** the user views the header
- **THEN** the "+ add dir" button is not shown

#### Scenario: Remove related repo
- **GIVEN** a related repo is listed
- **WHEN** the user hovers the repo name and clicks the red "-"
- **THEN** the repo is removed from the related list

#### Scenario: No current repo
- **GIVEN** no current repo is available (no active thread)
- **WHEN** the header renders
- **THEN** the current repo label is not shown

### Requirement: Auto Context Message Wrapper
When Auto context is enabled, GUI SHALL wrap the outgoing user message as:

#### Scenario: Wrap with current + related repos
- **GIVEN** Auto context is enabled with a current repo and two related repos
- **WHEN** the user sends a message
- **THEN** the outgoing text includes the header with current and two related repo lines

#### Scenario: Auto context disabled
- **GIVEN** Auto context is disabled
- **WHEN** the user sends a message
- **THEN** the outgoing text is the raw user input without a wrapper

Format example:

```
# Context from my IDE setup:

## Current repo: <absolute path>
## Related repo: <absolute path>
## Related repo: <absolute path>

## My request for Codex:
<raw user input>
```

Rules:
- If no related repos are selected, omit the related repo lines.
- If current repo is unavailable, omit the current repo line.
- The wrapper is applied only to the outgoing request; the UI should still display the raw user input.
- Repo selections are session-scoped and reset for new sessions.
