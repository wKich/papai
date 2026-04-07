# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.8.2] - 2026-04-07

### Added

- Add LLM timeout limits to proactive and memory generateText calls
## [4.8.1] - 2026-04-07

### Added

- **debug:** Expand dashboard log buffer, history, and trace step details

### Fixed

- Resolve username to user ID in Mattermost group commands

### Ci

- Disable mutation testing in CI
## [4.8.0] - 2026-04-06

### Added

- **debug:** Add LLM trace detail modal and enhance dashboard UI
- Add client build script and test
- Extend TDD hooks to recognize client/ and scripts/ source roots
- Create single entry point and update HTML
- Add happy-dom test setup preload
- Add build:client and test:client scripts
- Remove archive tools, add delete-project tool

### Changed

- Move client source files to client/debug/
- Update imports in moved client/debug files
- Use @happy-dom/global-registrator for canonical DOM setup
- Move client tests to tests/client/debug/
- Serve dashboard from pre-built public/ directory

### Documentation

- Add client build pipeline design
- Add client build pipeline implementation plan
- Update CLAUDE.md for client build pipeline

### Fixed

- Handle flat tests/client/ paths in resolveImplPath

### Miscellaneous

- Add happy-dom and gitignore public/
- Add test:client to check:full pipeline
- Add client build stage to Dockerfile
- Extend knip scope to client/ and remove dead search module

### Testing

- Adapt smoke tests for single-bundle serving

### Ci

- Add build job for client assets
- Drop unused build artifact dependency from e2e and mutation jobs
## [4.7.8] - 2026-04-05

### Added

- **tdd:** Add import verification to prevent test bypass

### Changed

- **llm:** Add deps parameter to processMessage for DI testing
- Add deps parameters to conversation, memory, embeddings, proactive-llm
- Add DI to completion-hook, create-recurring-task, announcements, task-status; remove db/index and changelog-reader from mock-reset
- Add DI to bot, admin commands, and scheduler; remove registry and llm-orchestrator from mock-reset
- Add DI to remaining recurring tool factories (delete, update, pause, skip, list, resume)
- Remove test-only exports from source modules

### Documentation

- **test-helpers:** Document beforeEach usage pattern for mock helpers
- **tests:** Update CLAUDE.md for global mock reset pattern
- Update testing conventions with DI pattern documentation

### Fixed

- Mark setSchedulerDeps as @public for knip unused-export check
- Update mockDrizzle docstring and remove empty beforeEach

### Miscellaneous

- Remove test-health check (superseded by global mock reset)
- Remove superseded spyOn migration plan document

### Testing

- Add global mock reset preload to eliminate mock pollution
- Move mock helpers to beforeEach in tools/db/commands tests
- Move mock helpers to beforeEach in providers/message-cache/chat tests
- Move mock helpers to beforeEach in remaining helper-only files
- Move drizzle mock.module to beforeEach in simple inline mock files
- Move AI SDK mock.module to beforeEach
- Move complex multi-mock files to beforeEach pattern
- Move remaining inline mock.module calls to beforeEach
- Extract duplicated mock setup to file-level beforeEach
- **helpers:** Replace mockDrizzle mock.module with _setDrizzleDb setter
- Remove mockDrizzle calls (setupTestDb auto-sets drizzle)
- Replace drizzle mock.module with _setDrizzleDb in all test files
- Remove drizzle from mock-reset (DI migration complete for drizzle)
- Remove vestigial db/index mock.module (exports don't exist)
## [4.7.7] - 2026-04-04

### Documentation

- Add ADR-0047 for session-level mutation testing rejection
- Add ADRs for completed features and clean up code
- Add mock pollution elimination design and implementation plans

### Fixed

- **debug:** Fix dashboard browser errors and add smoke tests
- **debug:** Improve dashboard initialization and update tests
- Send welcome message after demo mode auto-provisioning
## [4.7.6] - 2026-04-04

### Added

- **kaneo:** Generate unique email addresses and slugs per registration

### Changed

- **config:** Replace wizard-hijack with standalone config-editor
- **tdd:** Remove dead code from mutation testing utilities
- **tdd:** Remove session-level mutation baseline from hooks

### Fixed

- Resolve explicit-function-return-type and no-unnecessary-type-arguments lint errors
- Prevent TDD hook from sending prompts when user interrupts session
- /user remove now correctly reports when user doesn't exist

### Testing

- **commands:** Update admin tests for unique email format
## [4.7.5] - 2026-04-03

### Changed

- **announce:** Remove auth.allowed check, add p-limit, extract test helper
## [4.7.4] - 2026-04-02

### Fixed

- **deploy:** Add DEMO_MODE to CI workflow .env generation
## [4.7.3] - 2026-04-02

### Fixed

- **wizard:** Single-step edit confirmation was broken
- Skip wizard auto-start for demo users
- **deploy:** Transfer CADDY_ADDITIONAL_CONFIG via SCP instead of heredoc
## [4.7.2] - 2026-04-02

### Added

- **tdd:** Add Claude and Opencode TDD enforcement hooks
- **tdd:** Add pre-stop checks for uncommitted changes and check:full
- Add copyAdminLlmConfig for demo mode
- Auto-add unknown DM users in demo mode
- Copy admin LLM config after Kaneo provisioning in demo mode

### Changed

- **wizard:** Extract shared logger mock and improve test organization
- Rename test files to match src/ convention

### Documentation

- Add mock.module to spyOn migration plan
- **plan:** Update migration plan with current progress
- Add DEMO_MODE to .env.example

### Fixed

- Single field edit from /config and skip to keep existing values
- **plan:** Address 7 issues in demo auto-provision implementation plan
## [4.7.1] - 2026-03-31
## [4.7.0] - 2026-03-31

### Added

- **debug:** Add event bus with zero-overhead guard
- **debug:** Add state collector with lazy bus subscription
- **debug:** Add Bun.serve() debug server with SSE and dashboard
- **debug:** Wire debug server into startup and shutdown
- **wizard:** Add validation service skeleton
- **wizard:** Implement API key validation
- **wizard:** Add base URL validation
- **wizard:** Add model existence validation
- **wizard:** Update WizardStep type for async live validation
- **wizard:** Export validation service from index
- **wizard:** Add live validation to API key step
- **wizard:** Add live validation to base URL step
- **wizard:** Add live validation to model steps
- **wizard:** Integrate live validation into engine
- **wizard:** Add interactive button support for validation errors
- Interactive config editing with buttons and pre-filled values
- Auto-start setup wizard for new users on first interaction
- Add /start command with welcome message
- **debug:** Add log ring buffer with search and stream adapter
- **debug:** Add /logs and /logs/stats routes with ring buffer wiring
- **scheduler:** Add type definitions
- **scheduler:** Implement core scheduler with retries
- **scheduler:** Add cron expression support via Bun.cron
- **scheduler:** Add central scheduler instance with cleanup tasks
- **debug:** Add persistence accessors and getMessageCacheSnapshot facade
- **debug:** Add getSchedulerSnapshot and getPollerSnapshot facades
- **debug:** Add getWizardSnapshots and getSessionSnapshots facades
- **debug:** Rewrite state-collector with admin filtering and wire adminUserId
- **debug:** Instrument bot.ts and llm-orchestrator.ts with lifecycle events
- **debug:** Instrument cache, conversation, and wizard with lifecycle events
- **debug:** Instrument scheduler, poller, and message-cache with lifecycle events
- **debug:** Serve dashboard static files with Bun.build() transpilation
- **debug:** Complete dashboard HTML with live debug panels
- Add shared TDD core modules (test-resolver, session-state, test-runner)
- Add Claude Code TDD adapter hooks and settings
- Add OpenCode TDD enforcement plugin
- Add Pattern 4 detection for module-level mutable state
- Implement TDD enforcement hooks with pre/post tool validation
- **deploy:** Add debug and logging env vars, expose metrics port

### Changed

- **plan:** Derive WizardData from ConfigKey for single source of truth
- **plan:** Simplify validation logic for small_model and embedding_model steps
- **plan:** Convert wizard state to sync and remove unused files
- **wizard:** Validate at end instead of each step
- **wizard:** Improve UX and split into modules
- Extract large functions into modules without disabling lint rules
- Update YouTrack tests to use centralized mock helpers
- **debug:** Switch logger to pino.multistream for dynamic stream attachment
- **scheduler:** Fix lint violations and add unregister
- **message-cache:** Extract cleanup functions for scheduler
- **scheduler:** Migrate recurring task scheduler to use central scheduler
- **deferred-prompts:** Migrate to centralized scheduler
- **scheduler:** Extract methods to fix max-lines-per-function
- **scheduler:** Remove lint overrides and fix max-lines-per-function
- Rename mock-pollution to test-health script
- **debug:** Export stats/state objects, move resetStats to test helpers
- **tdd:** Fix code style in tdd-enforcement plugin and update SessionState instantiation
- **tdd:** Update surface extractor and related tests
- **tdd:** Complete session-level mutation testing optimization
- **tdd:** Fix mutation testing integration and session stop blocking
- Migrate mutation testing from per-file to session-level

### Documentation

- Add debug tracing tool design
- Add bot configuration UX design document
- Add bot configuration UX implementation plan
- Revise implementation plan with correct platform-agnostic architecture
- Add Session 1 event bus + server skeleton design
- Add Session 1 implementation plan
- **debug:** Align design doc with Session 1/2 implementation decisions
- Add file attachments research with caveats analysis
- Add scheduler utility design document
- Add scheduler utility implementation plan
- **debug:** Add Session 3 instrument source modules design
- **debug:** Add Session 3 implementation plan
- **debug:** Update design for client-side state management in Session 4
- **debug:** Add Session 4 dashboard HTML design
- **debug:** Add Session 4 dashboard HTML implementation plan
- Add LLM guidance research for large codebases
- Update .github/instructions and fix documentation formatting
- Add plugin system design document
- Add plugin system implementation plan
- Update TDD hooks integration plans and enhance Telegram reply context
- Add TDD enforcement protocol to CLAUDE.md, Copilot, and opencode

### Fixed

- **plan:** Store taskProvider in WizardSession instead of inferring from data
- **plan:** Don't intercept commands during active wizard
- **plan:** Use existing normalizeTimezone utility for timezone validation
- **plan:** Use storageContextId instead of contextId throughout wizard
- **plan:** Use text-based flow for Mattermost wizard instead of Interactive Dialogs
- **plan:** Use auth.storageContextId in bot.ts wizard integration
- **plan:** Remove async/await from sync wizard functions and use type guard
- **config:** Allow isConfigKey to validate all provider keys
- **wizard:** Save config under storageContextId and handle llm_baseurl default
- Remove typescript/no-unsafe-type-assertion override and fix tests
- **debug:** Make server log route tests resilient to logger mock pollution
- **debug:** Validate parseIntParam to ignore NaN query values
- **scheduler:** Use calculateBackoff helper to fix unused export
- **wizard:** Use TASK_PROVIDER env var instead of hardcoded 'kaneo'
- Increase Stryker timeout and reduce concurrency for CI
- Increase stryker bun runner timeout for CI
- Restore message cache from SQLite on startup
- Extract sender_name from Mattermost WebSocket events and deduplicate ONE_WEEK_MS constant
- Resolve lint errors in test-health script
- **tdd:** Correct input.args access and cwd-relative path resolution

### Miscellaneous

- Update readme
- **scheduler:** Final verification and cleanup

### Testing

- **plan:** Add fetch mocking to validation tests
- **debug:** Add log buffer unit tests (red)
- **debug:** Add log route integration tests (red)
- **scheduler:** Add integration tests for central scheduler
## [4.6.0] - 2026-03-27

### Added

- Redact sensitive values in /set command messages
- **db:** Add execution_metadata column to deferred prompt tables
- **schema:** Add executionMetadata column to scheduled and alert prompt tables
- **types:** Add ExecutionMetadata type and schema for deferred prompts
- **deferred:** Update row mappers and CRUD to handle executionMetadata
- **tools:** Add execution parameter to create/update deferred prompt tools
- **deferred:** Implement execution mode dispatch with lightweight, context, and full modes
- **poller:** Use dispatchExecution for mode-aware deferred prompt execution
- Implement in-memory message cache
- Add SQLite persistence for message cache
- Implement reply chain builder
- **telegram:** Extract and cache reply metadata
- **mattermost:** Add root_id and parent_id to post schema
- **mattermost:** Cache incoming messages and populate replyToMessageId
- **llm-orchestrator:** Add detailed APICallError logging for production debugging
- Implement personal memory & recall (Phase 06)
- Add message reply and quote context awareness

### Changed

- **deferred:** Remove invokeLlmWithHistory backward compat wrapper
- Extract DB cleanup interval into explicit startup function
- **mattermost:** Export extractReplyId and MattermostPostSchema
- Remove test-only exports from message-cache source

### Documentation

- Add deferred prompt execution modes design
- Add execution modes implementation plan
- Add design for message reply and quote context
- Add implementation plan for message reply and quote context
- **adr:** Add ADRs 0033, 0034 and 0008 for deferred prompts and architecture
- **plans:** Archive completed proactive and deferred prompt plans to done/
- **plans:** Update existing plans for memory recall and reply context
- **plans:** Remove plans moved to done/ archive
- **user-stories:** Add repo integration user stories
- Add Mattermost reply chain implementation design
- Add Mattermost reply chain implementation plan
- Add project logo and update README

### Fixed

- **test:** Remove unsafe type assertions in execution-modes tests
- **deferred:** Load history before appending in lightweight mode
- **test:** Close previous DB before creating new one in migration tests
- **plan:** Correct migration system instructions
- **plan:** Correct Drizzle onConflictDoUpdate syntax
- **plan:** Make all Drizzle operations synchronous
- **plan:** Use scoped child loggers
- **plan:** Add scheduled cleanup for expired messages
- **plan:** Align Task 8 with actual class-based extractMessage
- **security:** Use registry rule pack instead of deprecated ai-best-practices repo
- Use composite key (context_id, message_id) for message_metadata
- Schedule retry flush after persistence failure
- Add periodic sweep for expired message cache entries
- **tests:** Test real cache implementation by mocking only DB dependency
- Address review findings for memo feature
- Address review feedback from pullrequestreview-4016459408
- Refine auto-mode fallback and clarify archiveMemos doc comment
- **tests:** Resolve mock pollution in conversation tests

### Miscellaneous

- **security:** Remove unused .semgrep/config.yml
- Increate mutation testing concurrency
- Remove @public from buildReplyChain (now used by reply-context)

### Testing

- **migration:** Add tests for execution_metadata column migration
- **deferred:** Add failing tests for execution mode dispatch
- **tools:** Add tests for execution parameter on deferred prompt tools
- Add integration tests, fix knip unused exports
- **mattermost:** Add schema parsing tests for reply fields
- **mattermost:** Add reply chain extraction tests

### Db

- Add message_metadata table for reply chain tracking

### Design

- Telegram reply chain infrastructure for message context

### Plan

- Add implementation plan for telegram reply chain infrastructure

### Types

- Add CachedMessage and MessageMetadataRow types
## [Unreleased]

### Added

- **chat:** Message reply and quote context awareness
  - Bot captures when users reply to or quote messages
  - Parent message context included in LLM prompts
  - Reply chain summaries for multi-level threads
  - Bot responses thread correctly in Telegram and Mattermost
- **types:** `ReplyContext` and `ReplyOptions` types for reply chain tracking

## [4.5.1] - 2026-03-25

### Added

- **tools:** Add ToolMode to gate deferred prompt tools in proactive execution
- **deferred:** Use proactive mode to exclude scheduling tools during delivery
- **deferred:** Rewrite proactive trigger with spotlighting and delivery mode framing
- **prompt:** Rewrite PROACTIVE MODE and add PROMPT CONTENT guidance for deferred prompts
- **deferred:** Improve prompt field description to guide deliverable content

### Changed

- **prompt:** Remove timezone disclosure and conversion instructions from system prompt

### Documentation

- Add proactive delivery mode design for recursive scheduling fix
- Add proactive delivery mode implementation plan

### Fixed

- **utils:** Weekly schedule without days now defaults to Monday
- **utils:** LocalDatetimeToUtc now handles empty-string timezone via try/catch
- **tools:** Remove duplicate ToolMode declaration

### Miscellaneous

- Move completed datetime review fixes plan to done
- Add timezone ADR and move completed plans to done

### Styling

- **tools:** Move ToolMode declaration after imports

### Testing

- **utils:** Add DST transition tests for localDatetimeToUtc
## [4.5.0] - 2026-03-25

### Added

- Implement background events for deferred prompts
- **utils:** Add localDatetimeToUtc, semanticScheduleToCron, and utcToLocal utilities
- **tools:** Accept structured dueDate in create-task and convert local time to UTC
- **tools:** Accept structured dueDate in update-task and convert local time to UTC
- **tools:** Thread userId through makeCoreTools; convert UTC dueDate to local in get-task and list-tasks
- **tools:** Replace raw cronExpression with semantic schedule in create-recurring-task
- **tools:** Replace raw cronExpression with semantic schedule in update-recurring-task
- **tools:** Convert UTC nextRun/lastRun to local time in list, resume, and skip recurring task returns
- **deferred-prompts:** Accept local datetime for fire_at; convert to UTC in tool
- Add transitive import detection for mock pollution
- Add source file scanner for import graph building
- Add transitive mock pollution detection
- **background-events:** Implement polling and event processing

### Changed

- Proactive AI agent — use conversation history, locking, and natural prompts
- Extract shared system prompt builder for consistent proactive/interactive behavior
- **deferred-prompts:** Address review feedback
- **prompt:** Remove timezone disclosure and conversion instructions from system prompt
- **poller:** Use BuildProviderFn factory instead of direct TaskProvider

### Documentation

- Add background events design for deferred prompt history integration
- Add background events implementation plan
- Add afterEach cleanup guideline for mock pollution

### Fixed

- Address PR #64 review comments — deferred marking, failure handling, tests
- Persist memory facts from proactive tool results
- Add afterAll mock.restore to prevent transitive pollution
- Restrict Pattern 1 victims to test files only
- **instructions:** Propagate createdAt timestamp from cache to DB sync
- **tests:** Mock providers/factory.js instead of registry.js in orchestrator tests; add timezone guard in proactive-llm

### Miscellaneous

- Add date-fns and date-fns-tz dependencies
- Finalize workflow improvements and documentation
- Remove unused LocalDatetime type export
- Disable max-lines lint rule for scripts directory
## [4.4.0] - 2026-03-24

### Added

- Add migration 013 for deferred prompts tables
- Add deferred prompt types and alert condition Zod schema
- Implement task snapshot management for change detection
- Implement 5 unified deferred prompt LLM tools
- Implement deferred prompt LLM tools and polling loops
- Add deferred-prompts barrel export
- Wire deferred prompt pollers into bot startup/shutdown
- Add --staged flag to check-quiet script
- Add timezone validation for /set timezone command

### Changed

- Remove old proactive system, update schema with deferred prompt tables
- Remove unused deferred-prompts barrel export and knip ignore
- Add concurrency limit (5) for parallel LLM invocations
- Replace custom concurrency limiter with p-limit
- Remove redundant condition validation from CRUD layer
- Replace raw SQL datetime arithmetic with JS filtering

### Documentation

- Add deferred prompts design document
- Rewrite deferred prompts implementation plan
- Update documentation to reflect check-quiet and correct check command list
- Add --staged flag documentation to CLAUDE.md
- Update roadmap Phase 7 to reflect deferred prompts, add 7b for provider-gated fields
- Update ADR status and clean up completed implementation plans
- Archive outdated documents and add ADR 0031

### Fixed

- Safer configure_briefing/configure_alerts, clarify design doc as future work
- Register migration 013 in runtime migration list
- Resolve Drizzle type error in getScheduledPromptsDue
- Wire deferred prompt tools into makeTools, fix knip issues
- **scripts:** Address shell script security and robustness issues
- Replace N+1 task fetching with per-project listTasks approach
- Add userId ownership checks to advanceScheduledPrompt and completeScheduledPrompt
- Add explicit return types to tool execute functions
- **scripts:** Fix word splitting and shell portability issues in check-quiet.sh
- Validate value presence for operators that require it
- Update capturedAt on snapshot upsert
- Remove task.updatedAt from condition fields — providers don't supply it
- Add searchTasks fallback when provider lacks projects.list
- Prune stale snapshots for deleted tasks on each poll cycle
- Add userId ownership check to updateAlertTriggerTime
- Add concurrency limit (10) for user-level alert fan-out
- **tests:** Include getLogLevel in logger mock to prevent mock pollution
- Address PR review feedback from pullrequestreview-3997096442
- Log actual prompt and response to history, not metadata

### Miscellaneous

- Add check-quiet script to package.json
- Upgrade TypeScript to v6.0.2

### Security

- Sanitize condition values in describeCondition for LLM prompts
## [4.3.0] - 2026-03-23

### Added

- Add recurring task occurrences tracking and completion hook
- Implement Phase 07 — proactive assistance
- **scripts:** Add static analyzer for Bun test mock pollution
- **proactive:** Implement Phase 07 review fixes
- Implement custom instructions (save/list/delete via LLM tools)

### Changed

- **scripts:** Replace regex/string analysis with TypeScript AST

### Documentation

- Restore implemented plans and add Architecture Decision Records
- Archive completed plans and add ADRs 0017-0020
- Add test improvement roadmap and phase plans
- Add mock pollution prevention rules to CLAUDE.md
- Add custom instructions feature design
- Add custom instructions implementation plan

### Fixed

- Replace mock.spy with spyOn in scheduler test
- **tests:** Rewrite false-confidence tests to actually test production code
- **tests:** Rewrite processMessage tests to eliminate mock pollution
- **tests:** Stop mocking tools/index.js to fix YouTrack tools-integration
- **tests:** Eliminate mock pollution from bot-auth and recurring-tools test files
- **tests:** Resolve all mock pollution warnings, enable strict mode
- **tests:** Add mock.restore() cleanup to prevent mock pollution
- **tests:** Eliminate mock pollution by removing high-level module mocks
- Address PR #45 review comments — timestamps, validation, error consistency, test reliability
- Replace Output.object() with prompt-based JSON parsing for model compatibility
- Improve scheduler observability and fix test mock types
- **telegram:** Resolve start() blocking forever preventing post-startup tasks
- Implement Phase 6 test infrastructure & isolation improvements
- Improve test isolation and standardize mock patterns (Phase 6)
- Align listColumns mock signature with real options object API
- Normalize instruction text, enforce max length, strip createdAt from list output

### Miscellaneous

- Switch stryker to native bun test runner

### Testing

- Increase mutation score to 30.28% (Phase 1)
- **youtrack:** Add operations and labels tests (Phase 2)
- Implement Phase 2 test plan — fill critical module gaps
- **scripts:** Add integration tests for check-mock-pollution
- Implement Phase 3 schema validation and test reliability improvements
- Implement Phase 4 common-sense scenario gap tests (~41 new tests)

### Ci

- Disable mutation testing on pull requests
## [4.2.0] - 2026-03-21

### Added

- Implement Phase 01 YouTrack error classification (context, network detection, tests)
- Implement Phase 04 (CI trigger, delete task tests, confirmation gate tests)
- Implement Phase 05 (admin, bot-auth, set, config command handler tests)
- Implement recurring work automation (Phase 8)
- Add mutation testing thresholds and progress reporter
- Add timezone config key for recurring task scheduling
- Timezone-aware system prompt and due date handling

### Changed

- **tests:** DRY test suite with shared helpers and add duplicate detection

### Documentation

- Move completed plans to done
- Archive completed phase 02 and 03 plans

### Fixed

- Apply bun format and add CI concurrency group by commit SHA
- Apply PR review feedback - propagate labelId and projectId context in YouTrack error classification
- Rename unused reply param to _reply in bot-auth.test.ts (TS6133)
- Complete logger mock in recurring and cron tests to fix failing logger tests
- Simplify test command to use bun test auto-discovery
- Remove tests from ignorePatterns so tests are copied to sandbox
- **scripts:** Fix shell escaping in detect-duplicates.ts
- Await rejects assertion in propagates provider errors test
- **cron:** Validate step > 0 to prevent infinite loop on */0
- **recurring:** Address PR review feedback
- Address Phase 8 verification gaps

### Miscellaneous

- Add stryker mutation testing dependencies
- Add stryker mutation testing configuration
- Add mutation testing scripts and fix test paths
- Gitignore stryker temp dir and reports
- Whitelist stryker checker plugin in knip config
- Disable no-confusing-void-expression and await-thenable for tests; clean up task-resource tests
- **package:** Integrate duplicate detection into check script
- **package:** Rename test:duplicates to duplicates

### Testing

- Add tests for archive and relation methods in task-resource
- Fix exception assertion patterns in task-resource tests
- **cron:** Add test for negative step value (*/-1)

### Ci

- Add mutation testing job with incremental cache
- Restrict push trigger to master branch only
## [4.1.5] - 2026-03-20

### Ci

- Separate security scan job from check script
## [4.1.4] - 2026-03-20

### Fixed

- **ci:** Escape variables in deploy script heredoc
## [4.1.3] - 2026-03-20

### Documentation

- Redesign README with enterprise-grade standards
## [4.1.2] - 2026-03-20

### Added

- Add TASK_PROVIDER env var for single-provider deployment

### Fixed

- Add missing migration008GroupMembers import
## [4.1.1] - 2026-03-20

### Fixed

- Remove non-existent schemas directory from Dockerfile
## [4.1.0] - 2026-03-20

### Added

- Add ChatProvider interface and registry
- Migrate user ID columns from integer to text
- Decouple from Telegram via ChatProvider abstraction
- Multi-chat provider support, schema cleanup, and admin auto-seed
- Add drizzle database client wrapper
- **error-handling:** Improve error classification and user feedback
- Implement Phase 02 enhanced tool capabilities
- **phase-03:** Implement persistence and context improvements
- Add group_members table schema
- Update chat types for group support
- Add groups module with CRUD operations
- Update Mattermost provider for group support
- Add group management commands
- Add command context restrictions
- Propagate storage context through all layers
- Update help command for group context
- Complete group chat support implementation

### Changed

- Extract LLM orchestration module from bot.ts
- Accept LanguageModel instance in trimWithMemoryModel
- Relocate schemas into provider directories
- Extract shared Kaneo provisioning service
- Move youtrack schema tests to mirror src/ structure
- **tests:** Update tests to use Drizzle ORM
- Complete Drizzle ORM migration

### Documentation

- Add multi-chat provider design (Telegram + Mattermost)
- Add multi-chat provider implementation plan
- Add group chat documentation

### Fixed

- Use string literal instead of unsafe type assertion for mock model
- Resolve all lint warnings

### Miscellaneous

- Remove implemented and outdated plan documents
- Setup tdd poc hooks and roadmap phases user stories
- Add drizzle config and schema definitions
- Update gitignore for SQLite WAL files
- Ignore SQLite WAL files in gitignore
- Add bun check and bun fix scripts for parallel task execution

### Testing

- Add guardrails for e2e test execution
- Fix test isolation issues
- Complete group chat test suite

### Deps

- Add drizzle-orm and drizzle-kit
## [4.0.4] - 2026-03-19

### Fixed

- Add entrypoint script to fix /data permissions with su-exec dropping to bun user
- **docker:** Run as non-root bun user to satisfy security scanner
## [4.0.3] - 2026-03-19

### Fixed

- Create /data directory with bun user permissions for SQLite

### Ci

- Add typecheck and unit tests to pre-commit hook
- Upgrade codeql-action to v4 and add required permissions for SARIF upload
## [4.0.2] - 2026-03-19

### Fixed

- Add schemas directory to Dockerfile

### Ci

- Add typecheck and unit tests to pre-commit hook
## [4.0.1] - 2026-03-19
## [4.0.0] - 2026-03-19

### Added

- Add YouTrack as second provider to validate abstraction (Phase 6)
- Add delete-task tool and improve provider abstraction
- Implement missing YouTrack methods and fix comment interface
- **youtrack:** Add common schemas and enums
- **youtrack:** Add user schemas
- **youtrack:** Add comment schemas
- **youtrack:** Add project schemas
- **youtrack:** Add tag schemas
- **youtrack:** Add custom field schemas
- **youtrack:** Add agile board schemas
- **youtrack:** Add issue schemas
- **youtrack:** Add issue link schemas
- **youtrack:** Add schema index file
- **youtrack:** Complete schema definitions for YouTrack REST API
- Integrate Semgrep security scanning
- **youtrack:** Add production-ready Zod schemas for API response types
- **youtrack:** Wire Zod parse() into all operations for runtime API response validation

### Changed

- Add provider interface and error types (Phase 1)
- Add KaneoProvider adapter and provider registry (Phase 2)
- Rewire tools and bot to use TaskProvider interface (Phase 3)
- Rewire bot to use provider abstraction (Phase 4)
- Clean up provider layer imports (Phase 5)
- Rename columns.crud capability to statuses.crud
- Split coarse-grained capabilities into granular ones
- Extract operations to fix lint warnings
- Move src/kaneo/ into src/providers/kaneo/
- Move schemas to root schemas/ and restructure tests to mirror src/
- Remove migration infrastructure and reorganize types

### Documentation

- Add semgrep security integration design
- Add semgrep integration implementation plan
- Add mutation testing design with StrykerJS command runner approach
- Add mutation testing implementation plan

### Fixed

- Use pip install for semgrep instead of binary download
- Resolve semgrep CI error and knip unlisted binaries
- **youtrack:** Simplify ISSUE_FIELDS custom fields query to name-based shape
- **youtrack:** Update mappers to use name-based custom field lookup and schema types
- **youtrack:** Update ISSUE_LIST_FIELDS to name-based custom fields shape
- **knip:** Use ignoreFiles for test-only YouTrack schemas (files rule requires ignoreFiles not ignoreIssues)
- Add CHANGELOG.md to Docker image for version announcements

### Miscellaneous

- Create youtrack provider schemas directory
- Add directly-imported transitive deps to package.json
- Remove dead code flagged by knip
- Final knip cleanup — zero issues remaining
- Restore bin/ to .semgrep/.gitignore
- **youtrack:** Delete types.ts and update knip config for schemas

### Styling

- Fix lint warning by compressing long function signatures

### Ci

- Add knip job for unused dependency/export detection

### Revert

- Restore queueMicrotask in cache-db.ts (accidentally included in youtrack schema migration)
## [3.2.3] - 2026-03-17

### Fixed

- Use inputMessageCount to correctly slice assistant messages from LLM response
- Append all response.messages to history without slicing
## [3.2.2] - 2026-03-17

### Added

- Improve /context command output format
## [3.2.1] - 2026-03-17

### Added

- Announce new version to users with Kaneo accounts on startup
- **commands:** Add /context command to show memory context

### Changed

- Make /context admin-only and upload as text file
- Split cache.ts to fix max-lines warning
- Use dependency injection for bot in announcements

### Documentation

- Add multi-provider task tracker support plan
- Update CLAUDE.md and project documentation

### Fixed

- **bot:** Persist assistant responses to conversation history
- Clear in-memory facts cache in clearFacts()
- Resolve TypeScript type errors in announcements

### Styling

- Condense error logging to fix max-lines warning
## [3.2.0] - 2026-03-16

### Added

- Add e2e tests for labels and projects
- **e2e:** Add automatic Docker lifecycle management for E2E tests
- Add e2e tests for task comments
- Add e2e tests for task relations
- Add e2e tests for column management
- Add e2e tests for task archiving
- Add e2e tests for error handling
- Add e2e tests for user workflows
- Add e2e tests for label operations
- Add e2e tests for project archive

### Changed

- Remove eslint-disable comments from setup.ts
- Migrate to API-generated Zod schemas

### Documentation

- Add e2e testing documentation using existing docker-compose
- Fix e2e documentation code example
- Add Kaneo API bugs documentation
- Mark test coverage plan as completed
- Move completed test coverage plan to done directory
- Update CLAUDE.md with comprehensive e2e test coverage
- Research Kaneo column API endpoint patterns
- Document E2E test isolation issue with mock.module

### Fixed

- Add missing afterAll hooks to e2e tests
- E2e test verification and API fixes
- Resolve all lint warnings and type errors
- Remove eslint-disable comments and use Promise.all()
- Update unit tests for new multi-field update behavior
- **e2e:** Improve task-relations test quality
- Column color default and test config pattern
- Remove extra test from user workflows
- Correct comment retrieval filtering
- Update comment-resource test mocks to use correct schema
- Add await to error handling test assertions
- **tests:** Remove async/await from Bun expect().rejects.toThrow() calls
- Use unique column names to avoid conflicts with defaults
- Increase Docker startup timeout
- Address remaining E2E test failures
- Remove eslint-disable comments by fixing type annotations
- Correct activity field from 'message' to 'content' per API docs
- Parse actual API response for comment creation
- Resolve E2E test failures by aligning schemas with actual API responses
- Align types and test mocks with actual resource return types
- **e2e:** Use docker compose (v2) instead of docker-compose (v1)
- **ci:** Run unit tests only in the test job
- **kaneo:** Use 'todo' as default status when creating a task
- **tests:** Align task-resource mock columns with real Kaneo naming
- **kaneo:** Restore 'to-do' default status; fix column name mocks

### Miscellaneous

- Update e2e tests to reference bugs doc
- Add lint suppression check to pre-commit hook

### Styling

- Fix lint issues in test files

### Testing

- Complete comprehensive e2e test suite
- Run E2E suite and capture results
- Complete E2E test fixes - all criteria met
- Add mock restoration and microtask flush helpers
- Add mock restoration to project-tools.test.ts
- Add mock restoration to all tool tests
- Fix history persistence test for async caching
- Fix config cache test by clearing user cache
- Update task resource mocks to include to-do column
- Update comment resource tests for pending ID behavior
- Fix comment order in E2E test (newest first)
## [3.1.1] - 2026-03-13

### Added

- Add e2e test client with resource cleanup
- Add e2e tests for task lifecycle
- Add e2e test npm scripts using existing docker-compose
- Migrate existing config keys to renamed format

### Fixed

- Add missing projectId assertions in e2e test
- Move testClient initialization to beforeAll
## [3.1.0] - 2026-03-13

### Added

- Add e2e test setup module with provisioning

### Documentation

- Align config key names and update documentation for Kaneo

### Fixed

- Per-tool verification — fix bugs and improve test coverage
## [3.0.17] - 2026-03-12

### Fixed

- Fall back to JSON token when sign-up response has no session cookie
## [3.0.16] - 2026-03-12

### Added

- Allow specifying backup path in /migrate rollback
## [3.0.15] - 2026-03-12

### Fixed

- Migration column slug, API schemas, and e2e test verification

## [3.0.14] - 2026-03-12

### Fixed

- Match \_\_Secure- prefixed session cookie in provision.ts

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
