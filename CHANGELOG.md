# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation

- Add changelog automation design document
- Add changelog automation implementation plan

### Miscellaneous

- Add git-cliff configuration
- Add changelog scripts to package.json

### Ci

- Add release workflow for automated changelog

## [1.0] - 2026-03-06

### Added

- Show typing indicator while LLM is processing
- Implement multiuser support with admin management

### Documentation

- Update multi-user support plan with username support

### Fixed

- Convert markdown tables to plain text before entity parsing
- Code review fixes for search-issues label filtering bug

### Testing

- Expand and reorganise format tests

## [0.9] - 2026-03-06

### Added

- Add database migration framework
- Implement two-tier conversation history persistence
- Add format utility for Markdown to MessageEntity conversion
- Integrate markdown formatting with bot
- Add type guard for date_time entities and move handling to mapEntityWithExtras

### Changed

- Move tests from src/ to dedicated tests/ directory
- Remove lint disable comments and properly type entities
- Simplify entity mapping by returning null for unsupported entities
- Remove unused loadFacts import and simplify fact persistence

### Documentation

- Add plan reference to multi-user support roadmap item
- Add Markdown to HTML formatting design
- Add implementation plan for markdown formatting
- Fix marked API usage, test assertions, and file paths
- Fix markdown formatting design and implementation plan
- Fix markdown formatting design and impl plan
- Fix review feedback issues in markdown formatting plans
- Fix design doc async option and impl plan test paths
- Mark database migration framework as complete

### Fixed

- Migration validation and database cleanup
- Address code review feedback for conversation history persistence
- Use bold as default for date_time and unknown entity types
- Add intentional fallthrough comment for date_time case
- Address code review feedback for conversation history persistence
- Resolve TypeScript type errors in tests

### Miscellaneous

- Add @gramio/format and marked dependencies

### Styling

- Fix lint warnings in migrate.test.ts

### Testing

- Verify all tests pass and linting clean

## [0.1] - 2026-03-04

### Added

- Add discriminated union error types
- Add user-facing error message mapper
- Implement granular error messages
- Add comments, labels, due dates, relations, and project tools
- Add linear response shape guards
- **linear:** Add removeIssueLabel wrapper function
- **tools:** Add remove_issue_label tool
- **linear:** Add archiveIssue wrapper function
- **tools:** Add archive_issue tool

### Changed

- Extract resolveWorkflowState to fix function length warning

### Documentation

- Update CLAUDE.md to reflect current architecture
- Update README to reflect current features and architecture
- Add comprehensive unit testing coverage plan for papai
- Actualize roadmap to reflect current implementation state
- Add plan for Linear API response validation roadmap item
- Clarify deterministic classification for response-shape errors
- Mark remove labels and archive issues as complete

### Fixed

- Tighten guard checks and date validation
- Remove duplicate error log from requireEntity
- Apply remaining response guard review suggestions

### Miscellaneous

- Ignore .worktrees directory

[unreleased]: https://github.com/wKich/papai/compare/v1.0...HEAD
[1.0]: https://github.com/wKich/papai/compare/v0.9...v1.0
[0.9]: https://github.com/wKich/papai/compare/v0.8...v0.9
