# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.14] - 2026-03-12

### Fixed

- Match __Secure- prefixed session cookie in provision.ts
## [3.0.13] - 2026-03-12

### Fixed

- Remove Origin from sign-up request in provision.ts

## [3.0.12] - 2026-03-12

### Fixed

- Correct kaneo-db-fix command YAML and provision auth

## [3.0.11] - 2026-03-12

### Fixed

- Send Origin header on sign-up to ensure session cookie is returned

## [3.0.10] - 2026-03-12

### Fixed

- Patch kaneo apikey.user_id NOT NULL to enable API key creation

## [3.0.9] - 2026-03-11

### Fixed

- **provision:** Use Bearer token from response body instead of Set-Cookie

## [3.0.8] - 2026-03-11

### Fixed

- **provision:** Replace body-token fallback with sign-in fallback

## [3.0.7] - 2026-03-11

### Fixed

- **provision:** Add Origin header to all Better Auth requests and fix body token fallback
- **provision:** Use username or telegramId as email local part on pap.ai domain

## [3.0.6] - 2026-03-11

### Fixed

- **provision:** Fall back to session token from response body when Set-Cookie header is absent

## [3.0.5] - 2026-03-11

### Added

- Add /help command and register bot commands with Telegram

## [3.0.4] - 2026-03-11

### Added

- Disable Kaneo registration by default

### Changed

- Extract command handlers into src/commands/ directory

### Documentation

- Restore full changelog history

### Fixed

- Use --prepend to preserve existing changelog entries on release

### Miscellaneous

- Add CHANGELOG.md to oxfmt ignore

### Security

- Block SSO and OAuth callback paths in Caddy

## [3.0.3] - 2026-03-11

### Fixed

- Use internal Kaneo URL for provisioning to fix session cookie
- Install dependencies before format step in release workflow

## [3.0.2] - 2026-03-11

## [3.0.1] - 2026-03-11

## [3.0.0] - 2026-03-11

### Added

- Migrate from Linear to Kaneo
- Add Kaneo self-host services to docker compose
- Add comprehensive Linear → Kaneo migration script
- Add parent-child relation support for sub-issue migration
- Add E2E migration test script
- Expand E2E verification — comments, label assignments, priorities, accurate label count
- CI tests, deploy health check, workflow_run trigger, Kaneo provisioning on first interaction

### Changed

- Split migrateUser to fix max-lines-per-function lint warning
- Split E2E migration test into smaller modules
- Add Zod validation to kaneoFetch and remove all lint disable comments
- Extract migration test constants to break circular import
- Linear → Kaneo migration infrastructure and test helpers
- Skip pass-1 partial frontmatter write in createTaskFromIssue
- Consolidate schemas, fix partial PUT updates, restore fetch in tests
- **queue:** Replace recursion with promise chaining

### Fixed

- Resolve TS2532 in frontmatter buildDescriptionWithRelations
- Track only newly-created columns in stats.columns (was overcounting)
- Add cursor pagination to fetchLabels, fetchWorkflowStates, fetchProjects
- Linear to Kaneo migration script fixes and improvements
- Resolve lint errors without disabling rules
- Update CONFIG_KEYS expected length in tests
- **classify-error:** Map KaneoValidationError to validationFailed app error

### Miscellaneous

- Reduce migrate-linear-to-kaneo.ts line count to fix max-lines lint warning
- Add queue.ts utility (missed in earlier commits)

### Revert

- Rollback codebase to v1.1 state

## [2.0.0] - 2026-03-06

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

[3.0.3]: https://github.com/wKich/papai/compare/v3.0.2...v3.0.3
[3.0.2]: https://github.com/wKich/papai/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/wKich/papai/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/wKich/papai/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/wKich/papai/compare/v1.0...v2.0.0
[1.0]: https://github.com/wKich/papai/compare/v0.9...v1.0
[0.9]: https://github.com/wKich/papai/compare/v0.8...v0.9
[0.1]: https://github.com/wKich/papai/compare/v0.0.0...v0.1
