## ADDED Requirements
### Requirement: Exploration Grouping for Tooling Activity
GUI SHALL group contiguous `read`, `search`, and `list_files` activities (including aggregated reading-files) together with adjacent reasoning into an Exploration block in the Working area.
GUI SHALL label the Exploration block as "Exploring" while the turn is in progress, and "Explored" once complete, including the unique file count when available.

#### Scenario: Exploration grouping in progress
- **GIVEN** a turn contains consecutive `list_files`/`search`/`read` activities and reasoning
- **WHEN** the turn is still in progress
- **THEN** GUI shows a single Exploration block titled "Exploring" with nested items and a unique file count

#### Scenario: Exploration grouping completed
- **GIVEN** a turn contains consecutive `list_files`/`search`/`read` activities and reasoning
- **WHEN** the turn finishes
- **THEN** GUI shows the same group titled "Explored" and preserves the nested items

### Requirement: Reasoning Summary Segmentation with Content
GUI SHALL render each reasoning summary entry as its own reasoning block while also displaying reasoning content when present.
GUI SHALL preserve reasoning content visibility even when summaries are segmented.

#### Scenario: Reasoning summary produces multiple blocks
- **GIVEN** a reasoning item includes multiple summary entries and content
- **WHEN** GUI renders the Working area
- **THEN** GUI renders multiple reasoning blocks (one per summary entry) and still displays the reasoning content

#### Scenario: Reasoning content without summary
- **GIVEN** a reasoning item has no summary entries but includes content
- **WHEN** GUI renders the Working area
- **THEN** GUI renders a single reasoning block showing the content
