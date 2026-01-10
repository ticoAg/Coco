# gui-artifacts Specification

## Purpose
TBD - created by archiving change add-07-gui-shared-artifacts. Update Purpose after archive.
## Requirements
### Requirement: Artifacts Tab with Categories
GUI SHALL provide an Artifacts view in task detail that includes three subcategories: Reports, Contracts, and Decisions.

#### Scenario: Open artifacts categories
- **GIVEN** a task is selected
- **WHEN** the user opens the Artifacts view
- **THEN** the GUI shows category selectors for Reports, Contracts, and Decisions

### Requirement: Read Shared Artifacts from Task Directory
GUI SHALL read artifacts from the task directory shared folders: shared/reports, shared/contracts, and shared/decisions. Missing folders SHALL be treated as empty lists.

#### Scenario: Missing category folder
- **GIVEN** shared/contracts does not exist for a task
- **WHEN** the user selects the Contracts category
- **THEN** the GUI shows an empty state without errors

### Requirement: List Artifacts with Metadata
GUI SHALL list artifacts within the selected category, including file name and last modified time, and SHALL sort by most recently modified first.

#### Scenario: Sort by most recent
- **GIVEN** two artifacts with different modification times
- **WHEN** the artifacts list is rendered
- **THEN** the most recently modified artifact appears first

### Requirement: Render Artifact Content
GUI SHALL render Markdown for files with a .md extension. For other files, GUI SHALL display the raw text content.

#### Scenario: Render markdown preview
- **GIVEN** a markdown artifact is selected
- **WHEN** the preview panel renders
- **THEN** the GUI displays rendered Markdown content

### Requirement: Safe Artifact Access
GUI SHALL restrict artifact reads to paths within the task shared directories and SHALL reject absolute paths or path traversal attempts.

#### Scenario: Reject path traversal
- **GIVEN** a request that includes ../ in the artifact path
- **WHEN** the GUI requests artifact content
- **THEN** the backend rejects the request with an error

### Requirement: Polling Refresh
While the Artifacts view is active, GUI SHALL poll for updated lists and the selected artifact content at a fixed interval.

#### Scenario: Polling refresh updates view
- **GIVEN** a new artifact appears in shared/reports
- **WHEN** the polling interval elapses while the Reports category is active
- **THEN** the GUI refreshes the list and shows the new artifact

