# Roadmap

## Phase 1: Code Quality & Reliability

- [x] Structured logging — replace `console.error`/`console.log` with a leveled logger
- [x] Granular error messages — surface specific failure reasons to the user instead of generic "something went wrong"
- [x] Workflow state resolution error handling — warn when a status name doesn't match any team workflow state
- [ ] Linear API response validation — add Zod schemas and handle missing/unexpected fields from API responses
- [ ] Configurable limits — expose history cap (currently 40) and max tool steps (currently 5) via env vars

## Phase 2: Enhanced Tool Capabilities

- [x] Add comments to issues
- [x] Set due dates on issues
- [x] View issue details — full description and comments
- [x] Label management — list, create, and apply labels to issues
- [x] Issue relations — create and view blocks/duplicate/related relations
- [x] Create projects
- [ ] Remove labels from issues
- [ ] Delete / archive issues
- [ ] Assign issues to a cycle / iteration

## Phase 3: Persistence & Context

- [ ] Conversation history persistence — SQLite or file-based storage so history survives restarts
- [ ] User preference storage — default project, default priority
- [ ] Session continuity across bot restarts

## Phase 4: Developer Experience

- [x] CI pipeline — format + lint + type-check on push and pull_request to master
- [ ] Unit tests for Linear wrapper functions
- [ ] Integration test scaffolding

## Phase 5: Advanced Features

- [ ] Multi-user support with per-user authorization
- [ ] Webhook-based Linear notifications — issue assigned, status changed
- [ ] Configurable LLM provider — swap GPT-4o for other models
- [ ] Rate limiting and request throttling
