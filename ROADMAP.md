# Roadmap

## Phase 1: Code Quality & Reliability

- [ ] Structured logging — replace `console.error`/`console.log` with a leveled logger
- [ ] Granular error messages — surface specific failure reasons to the user instead of generic "something went wrong"
- [ ] Linear API response validation — add null checks and handle missing fields from API responses
- [ ] Workflow state resolution error handling — report when a status name doesn't match any team workflow state
- [ ] Configurable limits — expose history cap (currently 40) and max tool steps (currently 5) via env vars

## Phase 2: Enhanced Tool Capabilities

- [ ] Delete / archive issues
- [ ] Add and remove labels
- [ ] Add comments to issues
- [ ] Set due dates
- [ ] Assign issues to a cycle / iteration
- [ ] View issue details — full description, comments, and activity history

## Phase 3: Persistence & Context

- [ ] Conversation history persistence — SQLite or file-based storage so history survives restarts
- [ ] User preference storage — default project, default priority
- [ ] Session continuity across bot restarts

## Phase 4: Developer Experience

- [ ] Unit tests for Linear wrapper functions
- [ ] Integration test scaffolding
- [ ] CI pipeline — lint + type-check on push

## Phase 5: Advanced Features

- [ ] Multi-user support with per-user authorization
- [ ] Webhook-based Linear notifications — issue assigned, status changed
- [ ] Configurable LLM provider — swap GPT-4o for other models
- [ ] Rate limiting and request throttling
