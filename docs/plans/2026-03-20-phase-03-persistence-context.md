# Phase 03: Persistence & Context — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-03-persistence-context.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Users can return to the bot after any interruption — restart, long break, or 100-message session — and continue managing their tasks without re-explaining context. The bot remembers recent entities, decisions, and conversation history across sessions.
- **Success Metrics**:
  - Sending a follow-up message in a new session correctly references entities from the previous one
  - A service restart does not cause the bot to lose history, summary, or remembered facts
  - A 50-message-deep reference to a project or decision is resolved accurately
  - Informally naming a previously-interacted project in a later session resolves without clarification
  - "What were we working on last time?" produces a relevant, accurate recap
- **Priority**: High — foundational user experience; all other capability work depends on reliable context
- **Timeline**: 3–4 days

---

## Current State Audit

The persistence infrastructure was substantially built during earlier work. The outstanding items are a small number of correctness, quality, and coverage gaps rather than net-new functionality.

### What is already in place

| Feature                                                                                     | Status                | Location                                                     |
| ------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| `conversation_history` SQLite table                                                         | ✅ Schema + migration | `src/db/schema.ts`, `migrations/002_conversation_history.ts` |
| `memory_summary` SQLite table                                                               | ✅ Schema + migration | `src/db/schema.ts`, `migrations/001_initial.ts`              |
| `memory_facts` SQLite table                                                                 | ✅ Schema + migration | `src/db/schema.ts`                                           |
| Lazy-load history from DB on cold cache                                                     | ✅ Implemented        | `src/cache.ts: getCachedHistory`                             |
| Write-back via `queueMicrotask`                                                             | ✅ Implemented        | `src/cache-db.ts: syncHistoryToDb`                           |
| `getCachedSummary` with `summary_loaded` guard                                              | ✅ Implemented        | `src/cache.ts`                                               |
| `getCachedFacts` with `facts_loaded` guard                                                  | ✅ Implemented        | `src/cache.ts`                                               |
| Smart trim: `shouldTriggerTrim` + `runTrimInBackground`                                     | ✅ Implemented        | `src/conversation.ts`                                        |
| LLM-assisted history compression: `trimWithMemoryModel`                                     | ✅ Implemented        | `src/memory.ts`                                              |
| Summary injection as system message: `buildMemoryContextMessage`                            | ✅ Implemented        | `src/memory.ts`                                              |
| Fact extraction from mutation tool results                                                  | ✅ Implemented        | `src/memory.ts: extractFactsFromSdkResults`                  |
| Fact injection via `buildMessagesWithMemory`                                                | ✅ Implemented        | `src/conversation.ts`                                        |
| Migration runner with validation                                                            | ✅ Implemented        | `src/db/migrate.ts`                                          |
| Unit tests: `trimWithMemoryModel`, `loadSummary`, `upsertFact`, `buildMemoryContextMessage` | ✅ Present            | `tests/memory.test.ts`                                       |
| Unit tests: `loadHistory`, `saveHistory`, `clearHistory`                                    | ✅ Present            | `tests/history.test.ts`                                      |

### Confirmed gaps

| #   | Gap                                                                                                                                                                                                                    | Story | File(s)                                   | Priority |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------- | -------- |
| G1  | `getCachedHistory` has no "loaded" guard — users with empty history trigger a DB query on every `processMessage` call (unlike `getCachedSummary` / `getCachedFacts` which use `summary_loaded` / `facts_loaded` flags) | 1, 2  | `src/cache.ts`                            | Medium   |
| G2  | `buildMemoryContextMessage` hardcodes `"Recently accessed Kaneo entities"` — exposes Kaneo branding in LLM context for non-Kaneo users                                                                                 | 4, 5  | `src/memory.ts`                           | Medium   |
| G3  | `TRIM_PROMPT` hardcodes `"Kaneo issues"` — biases the smart trim toward Kaneo-specific entities for non-Kaneo users                                                                                                    | 3     | `src/memory.ts`                           | Medium   |
| G4  | `extractFactsFromSdkResults` skips read tools (`get_task`, `list_projects`) — entities accessed only via reads are not persisted as facts and are forgotten after cache eviction                                       | 4     | `src/memory.ts`                           | Low      |
| G5  | No unit tests for `shouldTriggerTrim` or `buildMessagesWithMemory` in `conversation.ts` — zero coverage for the trim-trigger logic                                                                                     | 3     | `tests/` (missing `conversation.test.ts`) | High     |
| G6  | `tests/memory.test.ts` asserts `toContain('Recently accessed Kaneo entities')` — will break once G2 is fixed                                                                                                           | 4, 5  | `tests/memory.test.ts`                    | Medium   |
| G7  | No tests explicitly validating the User Stories 1–5 acceptance criteria at the function level                                                                                                                          | All   | `tests/`                                  | Medium   |

---

## Technical Architecture

### Component Map

```
User message
  └─ processMessage (llm-orchestrator.ts)
       ├─ getCachedHistory         ← lazy-loads from DB on cold start/restart
       ├─ appendHistory             ← writes new messages to cache + DB
       ├─ callLlm
       │    └─ buildMessagesWithMemory (conversation.ts)
       │         ├─ loadSummary    ← reads from cache (DB-backed)
       │         ├─ loadFacts      ← reads from cache (DB-backed)
       │         └─ buildMemoryContextMessage (memory.ts)
       │              └─ injects as system message before history
       ├─ persistFactsFromResults  ← extracts + stores entities from tool results
       └─ shouldTriggerTrim
            └─ runTrimInBackground (async, best-effort)
                 └─ trimWithMemoryModel (memory.ts)
                      ├─ LLM call: select messages to keep + write new summary
                      ├─ saveSummary → cache + DB
                      └─ setCachedHistory → trimmed messages + DB
```

### Cold-start / restart data flow (User Stories 1, 2)

```
Bot restarts
  └─ userCaches = new Map()       ← in-memory cache is empty

User sends message
  └─ getCachedHistory(userId)
       └─ cache.history.length === 0 → query conversation_history table
            └─ parseHistoryFromDb → validated ModelMessage[]
  └─ getCachedSummary(userId)
       └─ !cache.config.has('summary_loaded') → query memory_summary table
  └─ getCachedFacts(userId)
       └─ !cache.config.has('facts_loaded') → query memory_facts table
  └─ buildMemoryContextMessage(summary, facts)
       └─ prepended as system message before history
  └─ LLM sees full prior context ✅
```

### Gap G1: Missing `history_loaded` guard

`getCachedSummary` and `getCachedFacts` both use a flag in `cache.config` to record that a DB load was attempted, preventing repeated DB queries for users with empty state. `getCachedHistory` only checks `cache.history.length === 0`, which re-queries the DB on every `processMessage` call for users who have cleared their history or never sent any messages.

Fix: add a `history_loaded` flag to `cache.config` in the same pattern used by `getCachedSummary`:

```typescript
// Before (current)
if (cache.history.length === 0) {
  // loads from DB, but re-queries every time if history is empty

// After (fix)
if (cache.history.length === 0 && !cache.config.has('history_loaded')) {
  // loads from DB once; subsequent calls skip the query
  cache.config.set('history_loaded', 'true')
```

Note: `clearHistory` must also call `cache.config.delete('history_loaded')` to allow the next load to re-read from the (now-empty) DB. The `setCachedHistory(userId, [])` path needs similar treatment.

### Gap G2 & G3: Provider-neutral strings in memory layer

Two string literals hardcode "Kaneo":

1. `buildMemoryContextMessage` in `src/memory.ts`:

   ```
   "Recently accessed Kaneo entities:\n..."
   ```

   → Replace with: `"Recently accessed entities:\n..."`

2. `TRIM_PROMPT` in `src/memory.ts`:
   ```
   "Prefer messages about active unresolved Kaneo issues..."
   ```
   → Replace with: `"Prefer messages about active unresolved tasks and projects..."`

The test in `tests/memory.test.ts` that asserts `.toContain('Recently accessed Kaneo entities')` must be updated alongside this change (Gap G6).

### Gap G4: Fact extraction for read tools

Currently `extractFactsFromSdkResults` processes only: `create_task`, `update_task`, `delete_task`, `create_project`, `update_project`, `archive_project`.

Cross-session recall of a project or task that was never mutated (only read via `get_task` or `list_projects`) is absent because those tool results are not processed. The fix extends fact extraction to:

- `get_task` → single task object (same `TaskResultSchema` as mutation tools)
- `list_projects` → array of project objects (apply `ProjectResultSchema` to each item up to a cap of 10)

`list_tasks` and `search_tasks` are explicitly excluded: they can return 100+ results and bulk-storing all of them as facts would pollute the 50-fact cap with low-value entries.

### Gap G5: Missing `conversation.ts` tests

`src/conversation.ts` exports three testable pure/async functions with non-trivial logic:

| Function                  | Key logic to test                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `shouldTriggerTrim`       | periodic trigger (every 10 user messages, once > 50 messages); hard cap at 100                                        |
| `buildMessagesWithMemory` | no memory → returns history unchanged; with summary → prepends system message; with facts → includes fact lines       |
| `runTrimInBackground`     | success path: calls `trimWithMemoryModel`, saves summary, resets history; config-missing path: logs warning, no crash |

No new library is needed. Tests follow the same pattern as `tests/memory.test.ts` (mock `ai`, mock DB modules).

### No new libraries required

All changes use existing dependencies:

| Library                  | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `bun:test`               | Test runner                                                      |
| `zod`                    | Schema validation (already used in `extractFactsFromSdkResults`) |
| `ai`                     | `ModelMessage` type; `generateText` mock in tests                |
| `drizzle-orm/bun-sqlite` | Test DB setup helper                                             |

---

## Detailed Task Breakdown

### Phase 1: Fix Provider-Neutral Strings (Gaps G2, G3, G6) — 0.5 days

- [ ] **Task 1.1**: Replace "Kaneo" in `buildMemoryContextMessage`
  - File: `src/memory.ts`
  - Estimate: 0.25h | Priority: **Medium**
  - Acceptance Criteria:
    - `"Recently accessed Kaneo entities:"` → `"Recently accessed entities:"`
    - `grep '"Kaneo' src/memory.ts` returns zero matches in that string
  - Dependencies: none

- [ ] **Task 1.2**: Replace "Kaneo issues" in `TRIM_PROMPT`
  - File: `src/memory.ts`
  - Estimate: 0.25h | Priority: **Medium**
  - Acceptance Criteria:
    - `"Prefer messages about active unresolved Kaneo issues"` → `"Prefer messages about active unresolved tasks and projects"`
    - The trim prompt no longer names a specific provider
  - Dependencies: none

- [ ] **Task 1.3**: Update `buildMemoryContextMessage` tests to match new string (Gap G6)
  - File: `tests/memory.test.ts`
  - Estimate: 0.25h | Priority: **Medium**
  - Acceptance Criteria:
    - The assertion `.toContain('Recently accessed Kaneo entities')` is replaced with `.toContain('Recently accessed entities')`
    - `bun test tests/memory.test.ts` passes with zero failures
  - Dependencies: Task 1.1

### Phase 2: Fix History Cache Guard (Gap G1) — 0.5 days

- [ ] **Task 2.1**: Add `history_loaded` flag to `getCachedHistory`
  - File: `src/cache.ts`
  - Estimate: 0.5h ±0.25h | Priority: **Medium**
  - Acceptance Criteria:
    - `getCachedHistory` guards the DB query with `!cache.config.has('history_loaded')`, matching the pattern in `getCachedSummary`
    - After the first load (hit or miss), `cache.config.set('history_loaded', 'true')` is called
    - `clearHistory` calls `cache.config.delete('history_loaded')` (or the equivalent `clearUserCache` helper invalidation) so that the next `getCachedHistory` call reloads from the freshly emptied DB
    - For `setCachedHistory`, calling it with an empty array should NOT set `history_loaded` (allowing subsequent warm-up from DB); OR it should set `history_loaded` and the cache reflects the explicitly set `[]` — choose the pattern consistent with `setCachedSummary`
  - Dependencies: none

- [ ] **Task 2.2**: Unit test for cold-cache DB load path in `getCachedHistory` (Gap G6)
  - File: `tests/history.test.ts`
  - Estimate: 0.5h | Priority: **Medium**
  - Acceptance Criteria:
    - Test: user has a row in `conversation_history`; cache is cold (freshly created `UserCache`); `getCachedHistory` returns the DB messages
    - Test: user has no row in DB; cache is cold; `getCachedHistory` returns `[]`
    - Test: after loading, a second call does NOT emit a second DB query (verify via spy or by ensuring the DB row returns something different after the first call — use a flag-based assertion if needed)
  - Dependencies: Task 2.1

### Phase 3: Unit Tests for `conversation.ts` (Gap G5) — 1 day

**New file**: `tests/conversation.test.ts`

- [ ] **Task 3.1**: Tests for `shouldTriggerTrim`
  - Estimate: 1h | Priority: **High**
  - Acceptance Criteria:
    - Returns `false` for 0, 1, 49 messages
    - Returns `false` when user message count is exactly divisible by 10 but history length is ≤ `TRIM_MIN` (50)
    - Returns `true` when user message count is a multiple of 10 AND history length > 50 (periodic trigger)
    - Returns `true` when history length ≥ 100 (`WORKING_MEMORY_CAP`) regardless of user message count
    - Returns `false` for 51 messages that are all `assistant` (no user messages)
  - Dependencies: none

- [ ] **Task 3.2**: Tests for `buildMessagesWithMemory`
  - Estimate: 1h ±0.25h | Priority: **High**
  - Acceptance Criteria:
    - No summary + no facts → `messages` equals input history; `memoryMsg` is `null`
    - Summary present + no facts → `messages[0]` is a `system` message containing the summary; `memoryMsg` equals `messages[0]`
    - Summary absent + facts present → `messages[0]` is a system message containing fact identifiers
    - Both present → `messages[0]` is a single system message containing both
    - Original history is not mutated in any case
    - Mocks: `mock.module('../src/cache.js', ...)` to inject controlled summary/facts
  - Dependencies: Task 1.1 (so fact string matches new provider-neutral label)

- [ ] **Task 3.3**: Tests for `runTrimInBackground`
  - Estimate: 1.5h ±0.5h | Priority: **High**
  - Acceptance Criteria:
    - Success path: `trimWithMemoryModel` is called with the full history; `saveSummary` is called with the returned summary; `setCachedHistory` is called with the trimmed messages
    - New messages added during async trim are preserved: history grows by N messages while trim is running → `setCachedHistory` receives `[...trimmedMessages, ...newMessages]`
    - Config-missing path: when `llm_apikey` / `llm_baseurl` / `small_model` are all `null`, the function logs a warning and returns without calling `trimWithMemoryModel`
    - `trimWithMemoryModel` failure: exception is caught; `setCachedHistory` is NOT called; a warning is logged
    - Mocks: mock `ai` module; mock `src/cache.js` for config and history access
  - Dependencies: none

### Phase 4: Fact Extraction for Read Tools (Gap G4) — 1 day

- [ ] **Task 4.1**: Extend `extractFactsFromSdkResults` to handle `get_task`
  - File: `src/memory.ts`
  - Estimate: 0.5h ±0.25h | Priority: **Low**
  - Acceptance Criteria:
    - A `get_task` result with `{ id, title, number }` produces a fact with `identifier: '#N'` (or the bare ID if `number` is absent), matching the existing mutation-tool extraction logic
    - Uses the existing `TaskResultSchema` parse path — no new schema required
    - All existing `extractFacts` tests continue to pass; the explicit `'does not extract fact from get_task result'` test in `tests/memory.test.ts` is updated to expect `length 1`
  - Dependencies: none
  - Note: the existing test `'does not extract fact from get_task result'` explicitly asserts `toHaveLength(0)`; this test must be updated as part of this task

- [ ] **Task 4.2**: Extend `extractFactsFromSdkResults` to handle `list_projects`
  - File: `src/memory.ts`
  - Estimate: 0.75h ±0.25h | Priority: **Low**
  - Acceptance Criteria:
    - A `list_projects` result that is an array of `{ id, name, url? }` objects produces one fact per project (using `ProjectResultSchema`), capped at the first 10 entries
    - A non-array or empty-array result produces zero facts (no throw)
    - New unit tests in `tests/memory.test.ts` cover: array with 3 projects → 3 facts; array with 12 projects → 10 facts (cap); empty array → 0 facts; malformed item → skipped gracefully
  - Dependencies: none

### Phase 5: Acceptance Criteria Validation Tests (Gap G7) — 1 day

These tests validate the acceptance criteria from the user stories directly, using controlled test doubles. They verify the **composition** of the persistence layer rather than individual functions.

- [ ] **Task 5.1**: Story 1 AC test — "continuing from previous session"
  - File: `tests/history.test.ts` (extend) or new `tests/persistence-ac.test.ts`
  - Estimate: 1h | Priority: **Medium**
  - Acceptance Criteria:
    - Test sequence: `saveHistory(userId, [msg1, msg2])` → clear cache → `loadHistory(userId)` → returns `[msg1, msg2]`
    - Confirms that a second "session" (cold cache) picks up history written by a prior "session"
  - Dependencies: Task 2.1

- [ ] **Task 5.2**: Story 2 AC test — "surviving restart"
  - File: `tests/persistence-ac.test.ts`
  - Estimate: 1h | Priority: **Medium**
  - Acceptance Criteria:
    - Test sequence: save history + summary + facts → clear all user caches → reload each → confirm values match
    - Use the same in-memory SQLite + Drizzle setup as `tests/memory.test.ts`
  - Dependencies: Tasks 2.1, 1.1

- [ ] **Task 5.3**: Story 3 AC test — "context retained at message 50+"
  - File: `tests/conversation.test.ts` (extend Task 3.1)
  - Estimate: 0.5h | Priority: **Medium**
  - Acceptance Criteria:
    - Build a history of 55 user + assistant message pairs
    - `shouldTriggerTrim` returns `true`
    - `shouldTriggerTrim` returns `false` at 49 messages (below threshold)
  - Dependencies: Task 3.1

- [ ] **Task 5.4**: Story 4 AC test — "key facts remembered after read"
  - File: `tests/memory.test.ts` (extend)
  - Estimate: 0.5h | Priority: **Medium**
  - Acceptance Criteria:
    - Call `extractFactsFromSdkResults` with a `get_task` result → fact is returned
    - Call `extractFactsFromSdkResults` with a `list_projects` result → facts are returned
    - Call `buildMemoryContextMessage(null, facts)` → LLM context contains the project name
  - Dependencies: Tasks 4.1, 4.2

- [ ] **Task 5.5**: Story 5 AC test — "summary injected into context"
  - File: `tests/conversation.test.ts` (extend Task 3.2)
  - Estimate: 0.5h | Priority: **Medium**
  - Acceptance Criteria:
    - `buildMessagesWithMemory(userId, history)` when summary is `"User worked on mobile app project"` → the returned messages array starts with a system message containing that text
    - The LLM would therefore have access to this summary when responding to "what were we working on?"
  - Dependencies: Task 3.2

---

## Risk Assessment Matrix

| Risk                                                                                                                                         | Probability | Impact | Mitigation                                                                                                                                                                 | Owner |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `clearHistory` not invalidating `history_loaded` flag → stale empty cache after clear                                                        | Medium      | High   | Explicitly test the `clearHistory` → `getCachedHistory` round-trip in Task 2.2; add the `cache.config.delete('history_loaded')` call to `clearHistory` as part of Task 2.1 | Dev   |
| `tests/memory.test.ts` assertion on `'Recently accessed Kaneo entities'` breaks if Task 1.3 is not applied in the same diff as Task 1.1      | High        | Low    | Tasks 1.1 and 1.3 are bundled — never merge Task 1.1 without Task 1.3                                                                                                      | Dev   |
| `get_task` fact extraction (Task 4.1) conflicts with existing test that explicitly asserts zero facts for `get_task` results                 | High        | Low    | The test must be updated as part of Task 4.1; the acceptance criteria for Task 4.1 explicitly call this out                                                                | Dev   |
| `runTrimInBackground` test (Task 3.3) is sensitive to async ordering — microtask vs. macrotask timing                                        | Medium      | Medium | Use `flushMicrotasks()` helper from `tests/test-helpers.ts` (already used in `history.test.ts`); `queueMicrotask` is synchronously flushable in test environments          | Dev   |
| `list_projects` returns deeply nested objects for some providers; `ProjectResultSchema` with `z.looseObject` drops unknown fields gracefully | Low         | Low    | The existing schema already uses `z.looseObject`; no schema change required                                                                                                | Dev   |
| Smart trim fires during tests if real cache + real history are used without mocks                                                            | Medium      | Low    | All tests mock the `ai` module and use in-memory SQLite; no real LLM calls are made in tests                                                                               | Dev   |

---

## Resource Requirements

- **Development Hours**: 14–18h total
- **Skills Required**: TypeScript, Bun test patterns (mock.module, flushMicrotasks), SQLite/Drizzle in-memory test setup
- **External Dependencies**: None
- **Testing Requirements**: All changes must pass `bun test` before merge; no new oxlint violations; `grep '"Kaneo' src/memory.ts` returns zero matches in `description` / `content` strings after Phase 1

---

## No New Libraries Required

All functionality is delivered using existing dependencies:

| Library                  | Version           | Purpose                                        |
| ------------------------ | ----------------- | ---------------------------------------------- |
| `bun:test`               | built-in          | Test runner                                    |
| `zod`                    | already installed | Schema parsing in `extractFactsFromSdkResults` |
| `ai`                     | already installed | `ModelMessage` type; mocked in tests           |
| `drizzle-orm/bun-sqlite` | already installed | In-memory test DB setup                        |
| `pino`                   | already installed | Logging in `runTrimInBackground`               |

---

## Delivery Order and Parallelisation

```
Day 1 (morning):  Task 1.1 + 1.2 + 1.3  (quick wins, unblock G6)
Day 1 (afternoon): Task 2.1 + 2.2         (cache guard + test)
Day 2:             Tasks 3.1, 3.2, 3.3    (conversation.ts test coverage) ← highest-value gap
Day 3 (morning):  Tasks 4.1 + 4.2         (read-tool fact extraction)
Day 3 (afternoon): Tasks 5.1–5.5           (AC validation tests)
```

Tasks 1.1/1.2/1.3 and Task 2.1 are independent — both can start on Day 1 in parallel if two developers are available. Tasks 3.1–3.3 can be parallelised across engineers since they test independent functions.
