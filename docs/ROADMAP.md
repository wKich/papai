# Roadmap

## Phase 1: Code Quality & Reliability

- [x] Structured logging — replace `console.error`/`console.log` with a leveled logger
- [x] [Granular error messages](docs/plans/2025-03-03-granular-error-messages.md) — surface specific failure reasons to the user instead of generic "something went wrong"
- [x] Workflow state resolution error handling — warn when a status name doesn't match any team workflow state
- [x] [Linear API response validation](docs/plans/2026-03-03-linear-api-response-validation.md) — add Zod schemas and handle missing/unexpected fields from API responses
- [x] ~~Configurable limits — history cap set to 100, max tool steps set to 25~~ (Not planned)

## Phase 2: Enhanced Tool Capabilities

- [x] Add comments to issues
- [x] Set due dates on issues
- [x] View issue details — full description and comments
- [x] Label management — list, create, and apply labels to issues
- [x] Issue relations — create and view blocks/duplicate/related relations
- [x] Create projects
- [x] [Remove labels from issues](docs/plans/2026-03-04-remove-labels-archive-issues.md)
- [x] [Delete / archive issues](docs/plans/2026-03-04-remove-labels-archive-issues.md)
- [x] ~~Assign issues to a cycle / iteration~~ (Not planned)

## Phase 3: Persistence & Context

- [x] [Database migration framework](docs/plans/2026-03-05-db-migrations.md) — lightweight versioned migration runner in `src/db/`, single shared `Database` instance, prerequisite for all schema changes
- [x] [Conversation history persistence](docs/plans/2026-03-05-conversation-history-persistence.md) — SQLite-backed two-tier memory: smart-trimmed working window (50-100 messages, memory-model-selected) + rolling summary + structured entity facts
- [x] Fix conversation prompt — persist assistant responses to enable multi-turn conversations
- [x] ~~User preference storage — default project, default priority~~ (Not planned)
- [x] ~~Session continuity across bot restarts~~ (Covered by conversation history persistence)

## Phase 4: Developer Experience

- [x] CI pipeline — format + lint + type-check on push and pull_request to master
- [x] [Unit tests for Linear wrapper functions](docs/plans/2025-03-03-unit-testing-coverage.md) — 95 tests across all linear modules and tool execute functions

## Phase 5: Advanced Features

- [x] [Multi-user support with per-user authorization](docs/plans/2026-03-05-multi-user-support.md)
- [x] Configurable LLM provider — swap GPT-4o for other models
- [x] ~~Rate limiting and request throttling~~ (Not planned)

## Phase 6: Personal Assistant Expansion

> See [design doc](docs/plans/2026-03-04-personal-assistant-expansion-design.md) for full specification.

- [ ] Quick capture & memos — save, search, list, and delete unstructured notes via natural language
- [ ] Semantic recall — vector-embedding search across memos (`recall` tool)
- [ ] Proactive daily briefing — cron-scheduled morning summary of Linear issues and agenda
- [ ] Deadline nudges — automated reminders for approaching and overdue Linear issues
- [ ] User-scheduled reminders — natural language reminder creation and management
- [ ] Calendar integration — read-only event and free/busy awareness (provider TBD)

## Backlog

- [ ] Integration test scaffolding
- [ ] Webhook-based Linear notifications — useful when external systems mutate Linear state (GitHub/CI auto-transitions, Sentry auto-created issues, Linear UI edits)
- [ ] **Investigate pre-existing logic bug in `classify-error.ts`** — The `message.includes('issue')` matcher at line 19 is overly broad and could misclassify errors (e.g., "Configuration issue: timeout" → issue-not-found). Review error classification logic and tighten matchers.
