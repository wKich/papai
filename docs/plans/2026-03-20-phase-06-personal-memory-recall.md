# Phase 06: Personal Memory & Recall — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-06-personal-memory-recall.md`  
**Storage decision**: Option A — SQLite + Vercel AI SDK brute-force (see `docs/plans/2026-03-20-memory-storage-research.md`)  
**Embedding strategy**: Remote embeddings via user's configured LLM endpoint (`ai.embed()`)  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Users can capture fleeting thoughts, decisions, and links in the same interface they use to manage tasks. Notes are instantly retrievable by keyword, tag, or natural language meaning — without remembering exact phrasing. Actionable notes can be promoted to tracked tasks without re-entering data.
- **Success Metrics**:
  - A note sent as "note: lease renewal deadline is June 15" is saved and confirmed within one exchange
  - Searching "find my notes tagged landlord" returns all matching memos with content and date
  - Asking "what did I write about the landlord?" retrieves a memo containing neither "landlord" nor the search keyword, via semantic similarity
  - "Turn my lease renewal note into a task" creates a task in the tracker with the correct title and due date derived from the memo
  - "Show my recent notes" lists the most recently saved memos newest-first
  - Archiving by tag or age runs and confirms how many memos were affected, without touching unmatched records
- **Priority**: High — first-class personal data model extending the bot beyond task management
- **Timeline**: 4–5 days

---

## Technology Decision Summary

**Chosen: Option A — SQLite + Vercel AI SDK brute-force cosine similarity**

| Decision Point             | Choice                                                        | Rationale                                                            |
| -------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Vector storage             | BLOB column in `memos` table (`Float32Array`)                 | Zero new deps; same DB file, same migration pipeline                 |
| Semantic similarity        | `embed()` + `cosineSimilarity()` from `ai` package            | Already in `package.json`; correct API already used in conversation  |
| Full-text search           | SQLite FTS5 virtual table (`memos_fts`)                       | Built into Bun's SQLite; no external index needed                    |
| Relationship model         | `memo_links` adjacency table + recursive CTEs                 | SQL joins cover all queries at personal scale (hundreds of memos)    |
| Embedding provider         | User's configured LLM endpoint (`llm_baseurl` / `llm_apikey`) | Aligns with per-user config model; no new credentials needed         |
| Embedding fallback         | FTS5 keyword search when `embed()` is unavailable             | Graceful degradation — memo capture and keyword search always work   |
| Embedding model config key | New `embedding_model` config key (optional)                   | Separate from `main_model`; many endpoints use different model names |

**New dependencies**: Zero production packages. Schema migration + new source modules only.

---

## Current State Audit

### What is already in place

| Feature                                                               | Status       | Location                                  |
| --------------------------------------------------------------------- | ------------ | ----------------------------------------- |
| SQLite via `bun:sqlite` + Drizzle ORM                                 | ✅ Complete  | `src/db/drizzle.ts`, `src/db/schema.ts`   |
| Migration runner with ordered, validated migrations                   | ✅ Complete  | `src/db/migrate.ts`, `src/db/index.ts`    |
| Per-user config (`llm_apikey`, `llm_baseurl`, etc.)                   | ✅ Complete  | `src/config.ts`, `src/types/config.ts`    |
| Vercel AI SDK (`ai` ^6.0.116) with `embed()` and `cosineSimilarity()` | ✅ Installed | `package.json`, `ai` package              |
| `@ai-sdk/openai-compatible` for LLM provider                          | ✅ Complete  | `src/llm-orchestrator.ts`                 |
| Tool pattern: `tool()` + Zod schema + `execute()`                     | ✅ Complete  | `src/tools/create-task.ts` et al.         |
| Tool registration in `makeTools()`                                    | ✅ Complete  | `src/tools/index.ts`                      |
| LLM system prompt in `llm-orchestrator.ts`                            | ✅ Complete  | `src/llm-orchestrator.ts`                 |
| `MemoryFact` type + `memoryFacts` table                               | ✅ Complete  | `src/types/memory.ts`, `src/db/schema.ts` |
| In-memory user cache (`userCaches`)                                   | ✅ Complete  | `src/cache.ts`                            |
| Cache write-back via `queueMicrotask`                                 | ✅ Complete  | `src/cache-db.ts`                         |

### Confirmed gaps (all new work)

| #   | Gap / New Feature                                            | Story     | File(s) to create or modify                                                                               |
| --- | ------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------- |
| G1  | No `memos` table, no `memos_fts` FTS5 virtual table          | US1–US7   | `src/db/schema.ts` (new tables), new migration `009_memos.ts`                                             |
| G2  | No `memo_links` table                                        | US5       | `src/db/schema.ts`, `009_memos.ts`                                                                        |
| G3  | No `embedding_model` config key                              | US4       | `src/types/config.ts`                                                                                     |
| G4  | No memo persistence layer                                    | US1–US7   | `src/memos.ts` (new)                                                                                      |
| G5  | No embedding helper (call `embed()` against user's endpoint) | US4       | `src/memos.ts` or `src/embeddings.ts` (new)                                                               |
| G6  | No LLM tools for memo CRUD, search, archive, promote         | US1–US7   | `src/tools/save-memo.ts`, `search-memos.ts`, `list-memos.ts`, `archive-memos.ts`, `promote-memo.ts` (new) |
| G7  | Memo tools not registered in `makeTools()`                   | US1–US7   | `src/tools/index.ts`                                                                                      |
| G8  | System prompt has no memo routing guidance                   | US2       | `src/llm-orchestrator.ts`                                                                                 |
| G9  | No memo context injection into conversation                  | US4 (opt) | `src/conversation.ts`                                                                                     |
| G10 | No unit or integration tests for any memo functionality      | All       | `tests/memos.test.ts`, `tests/tools/memo-tools.test.ts` (new)                                             |

---

## Technical Architecture

### Component map

```
User message
  └─ processMessage (llm-orchestrator.ts)
       ├─ buildMessagesWithMemory      ← injects any relevant memos as context (optional enrichment)
       └─ generateText (Vercel AI SDK)
            └─ LLM calls tools as needed:
                 ├─ save_memo          ← US1, US2
                 ├─ search_memos       ← US3, US4
                 ├─ list_memos         ← US6
                 ├─ archive_memos      ← US7
                 └─ promote_memo       ← US5

save_memo (tool)
  └─ saveMemo (memos.ts)
       ├─ generateSlug / nanoid → ULID for id
       ├─ parse tags from content
       ├─ INSERT INTO memos
       ├─ INSERT INTO memos_fts (trigger or explicit)
       └─ embedAndStore (async, best-effort)
            └─ embed(content) via user's LLM endpoint
                 └─ UPDATE memos SET embedding = blob

search_memos (tool)
  └─ searchMemos (memos.ts)
       ├─ if embedding available:
       │    ├─ embed(query) → queryVec
       │    ├─ load all active user embeddings from DB
       │    ├─ cosineSimilarity(queryVec, stored) for each
       │    └─ return top-5 by score (score > 0.7 threshold)
       └─ fallback: FTS5 MATCH query on memos_fts

list_memos (tool)
  └─ listMemos (memos.ts)
       └─ SELECT ... WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT ?

archive_memos (tool)
  └─ archiveMemos (memos.ts)
       └─ UPDATE memos SET status = 'archived' WHERE user_id = ? AND (tag match OR age condition)

promote_memo (tool)
  └─ createTask via existing task provider
       └─ memo content → task title + due date extraction by LLM
```

### Schema additions

```sql
-- Core memo store
CREATE TABLE memos (
  id          TEXT PRIMARY KEY,                           -- ULID generated in TS
  user_id     TEXT NOT NULL,
  content     TEXT NOT NULL,                              -- raw user note text
  summary     TEXT,                                       -- optional LLM-generated one-liner
  tags        TEXT NOT NULL DEFAULT '[]',                 -- JSON array e.g. '["landlord","deadline"]'
  embedding   BLOB,                                       -- Float32Array as little-endian BLOB, nullable
  status      TEXT NOT NULL DEFAULT 'active',             -- 'active' | 'archived'
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_memos_user_status_created
  ON memos(user_id, status, created_at DESC);

-- FTS5 virtual table — keeps content + tags in the index
CREATE VIRTUAL TABLE memos_fts
  USING fts5(content, summary, tags, content='memos', content_rowid='rowid');

-- Triggers to keep FTS5 in sync
CREATE TRIGGER memos_ai AFTER INSERT ON memos BEGIN
  INSERT INTO memos_fts(rowid, content, summary, tags)
  VALUES (new.rowid, new.content, new.summary, new.tags);
END;
CREATE TRIGGER memos_au AFTER UPDATE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts, rowid, content, summary, tags)
  VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
  INSERT INTO memos_fts(rowid, content, summary, tags)
  VALUES (new.rowid, new.content, new.summary, new.tags);
END;
CREATE TRIGGER memos_ad AFTER DELETE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts, rowid, content, summary, tags)
  VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
END;

-- Relationship links (memo↔memo, memo↔external task)
CREATE TABLE memo_links (
  id              TEXT PRIMARY KEY,
  source_memo_id  TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  target_memo_id  TEXT REFERENCES memos(id) ON DELETE SET NULL,
  target_task_id  TEXT,           -- opaque external task ID
  relation_type   TEXT NOT NULL,  -- 'related_to' | 'derived_from' | 'supersedes' | 'action_for'
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_memo_links_source ON memo_links(source_memo_id);
CREATE INDEX idx_memo_links_target_memo ON memo_links(target_memo_id);
```

### Embedding wire format

- Embeddings serialized as `Float32Array`, stored as raw BLOB bytes via `Buffer.from(new Float32Array(vec).buffer)`.
- On read: `new Float32Array(blob.buffer)`.
- Dimension is determined by the embedding model response. No fixed size stored — the BLOB length / 4 gives the dimension at read time.
- `cosineSimilarity(a, b)` from `ai` package operates on `number[]`; convert with `Array.from(float32array)`.

### Semantic search algorithm

```
function semanticSearch(userId, queryText, topN = 5, threshold = 0.65):
  queryVec ← embed(queryText, userEndpoint)      -- may throw if endpoint unavailable
  rows ← SELECT id, content, created_at, tags, embedding FROM memos
         WHERE user_id = userId AND status = 'active' AND embedding IS NOT NULL
  scored ← rows
    .map(r → { ...r, score: cosineSimilarity(queryVec, deserialize(r.embedding)) })
    .filter(r → r.score >= threshold)
    .sort(desc by score)
    .slice(0, topN)
  return scored
```

Fallback if `embed()` throws:

```
return fts5KeywordSearch(userId, queryText, topN)
```

### Routing heuristic (US2)

The LLM is given a routing instruction in the system prompt. No hard-coded classification — the LLM calls `save_memo` when the content is observational/informational, or `create_task` when the content is actionable. The tool descriptions encode this contract:

- `save_memo`: _"Save a personal note or observation. Use when the user is recording information, a thought, a link, or a fact — not when tracking work to be done."_
- `create_task`: _"Create a task to track. Use when the user wants to act on something."_

### Tag parsing strategy

Tags are extracted by the LLM when calling `save_memo`. The tool input schema includes an optional `tags` array. The system prompt instructs the LLM to populate `tags` from any hashtags or explicit "tag: X" mentions in the user message, plus its own inference.

---

## Detailed Task Breakdown

### Phase A: Schema & Persistence Layer (Day 1)

- [ ] **A1**: Add `embedding_model` to `ConfigKey` in `src/types/config.ts` and `CONFIG_KEYS` array
  - Estimate: 0.5h ±0.25h | Priority: H
  - Acceptance: `getConfig(userId, 'embedding_model')` compiles and returns `null` when unset; `/set embedding_model text-embedding-3-small` works via existing `/set` command
  - Dependencies: none

- [ ] **A2**: Write migration `src/db/migrations/009_memos.ts` — creates `memos`, `memos_fts` (FTS5 + triggers), `memo_links` tables
  - Estimate: 1h ±0.25h | Priority: H
  - Acceptance: Migration `up()` runs without error against a fresh in-memory SQLite. `SELECT * FROM memos_fts` is valid after migration. `PRAGMA foreign_keys=ON` is satisfied.
  - Dependencies: A1

- [ ] **A3**: Register migration `009_memos` in `src/db/index.ts` `MIGRATIONS` array
  - Estimate: 0.25h | Priority: H
  - Acceptance: `initDb()` runs all 9 migrations in sequence without error
  - Dependencies: A2

- [ ] **A4**: Add Drizzle schema definitions for `memos` and `memo_links` in `src/db/schema.ts`
  - Estimate: 0.5h ±0.25h | Priority: H
  - Acceptance: `tsc --noEmit` passes. Drizzle types for `$inferSelect` / `$inferInsert` are correct.
  - Dependencies: A2

- [ ] **A5**: Create `src/memos.ts` — persistence layer with functions:
  - `saveMemo(userId, content, tags, summary?) → Memo`
  - `getMemo(userId, memoId) → Memo | null`
  - `listMemos(userId, limit, status?) → Memo[]`
  - `updateMemoEmbedding(memoId, embedding: Float32Array) → void`
  - `keywordSearchMemos(userId, query, limit) → Memo[]` (FTS5)
  - `loadEmbeddingsForUser(userId) → Array<{ id, embedding: Float32Array }>`
  - `archiveMemos(userId, filter: ArchiveFilter) → number` (returns count)
  - Estimate: 3h ±1h | Priority: H
  - Acceptance: Each function has a corresponding unit test that runs against an in-memory SQLite instance (same approach as existing `tests/memory.test.ts`). No mock required — the DB itself is the test double.
  - Dependencies: A4

- [ ] **A6**: Create `src/embeddings.ts` — embedding helper wrapping `ai.embed()`:
  - `getEmbedding(text, apiKey, baseUrl, model) → Promise<number[]>` — calls `embed()`, throws on failure
  - `tryGetEmbedding(...)` — wraps the above, logs warning, returns `null` on failure (for best-effort paths)
  - Estimate: 1h ±0.25h | Priority: H
  - Acceptance: Unit test with a mocked `embed()` call (using `bun:test` `mock()`) verifies the returned array and the null-on-error behavior
  - Dependencies: none (uses already-installed `ai` package)

### Phase B: Tool Layer (Day 2)

All tools follow the existing pattern: `tool()` from `ai`, Zod input schema, `execute()`.

- [ ] **B1**: Create `src/tools/save-memo.ts` — `save_memo` tool
  - Input schema: `{ content: string, tags: string[] (optional), summary: string (optional) }`
  - execute: calls `saveMemo()` → fires `tryGetEmbedding()` + `updateMemoEmbedding()` asynchronously (best-effort, non-blocking)
  - Returns: `{ id, content, tags, createdAt }`
  - Estimate: 1h ±0.25h | Priority: H
  - Acceptance: Unit test verifies memo is persisted and embedding update is queued; tool returns confirmation object
  - Dependencies: A5, A6

- [ ] **B2**: Create `src/tools/search-memos.ts` — `search_memos` tool
  - Input schema: `{ query: string, mode: 'keyword' | 'semantic' | 'auto' (default 'auto'), limit: number (default 5) }`
  - execute: attempts semantic search (embed + cosine), falls back to FTS5 on `embed()` failure; returns array of matching memos with match score/mode info
  - Estimate: 2h ±0.5h | Priority: H
  - Acceptance: Unit tests for (a) semantic path with mock `embed()` returning known vector, (b) FTS5 fallback when `embed()` throws, (c) empty result set
  - Dependencies: A5, A6

- [ ] **B3**: Create `src/tools/list-memos.ts` — `list_memos` tool
  - Input schema: `{ limit: number (default 10), status: 'active' | 'archived' (default 'active') }`
  - execute: calls `listMemos()`, returns newest-first list with content and `created_at`
  - Estimate: 0.5h | Priority: H
  - Acceptance: Unit test confirms ordering and default limit
  - Dependencies: A5

- [ ] **B4**: Create `src/tools/archive-memos.ts` — `archive_memos` tool
  - Input schema: `{ tag: string (optional), before_date: string ISO (optional), memo_ids: string[] (optional) }` — at least one filter required
  - execute: validates at least one filter is present, calls `archiveMemos()`, returns count
  - Uses `confirmation-gate.ts` pattern for destructive confirmation when archiving by age (same pattern as `archive-task.ts`)
  - Estimate: 1.5h ±0.5h | Priority: M
  - Acceptance: Unit tests for (a) tag-scoped archive, (b) date-scoped archive, (c) rejection when no filter given, (d) confirmation required path
  - Dependencies: A5

- [ ] **B5**: Create `src/tools/promote-memo.ts` — `promote_memo` tool
  - Input schema: `{ memo_id: string, project_id: string (optional) }` — if no `project_id`, LLM must call `list_projects` first
  - execute: fetches memo text (`getMemo()`), then calls the task provider's `createTask()` with title + due date extracted from memo content; optionally links memo to new task via `memo_links`
  - Returns: `{ task_id, task_url, memo_id }` for confirmation message
  - Estimate: 2h ±0.5h | Priority: M
  - Acceptance: Unit test with a mocked task provider verifies correct title/due date extraction from known memo content; integration test verifies link is recorded
  - Dependencies: A5, task provider interface

### Phase C: Tool Registration & System Prompt (Day 3, morning)

- [ ] **C1**: Register all five memo tools in `src/tools/index.ts` `makeTools()` — no capability guard needed (memos are always available)
  - Estimate: 0.5h | Priority: H
  - Acceptance: `makeTools(provider)` returns an object containing `save_memo`, `search_memos`, `list_memos`, `archive_memos`, `promote_memo`
  - Dependencies: B1–B5

- [ ] **C2**: Add memo routing guidance to the system prompt in `src/llm-orchestrator.ts`
  - Add a `MEMOS` section after `RELATION TYPES`, covering:
    - When to call `save_memo` vs `create_task` (observation vs action)
    - How to populate `tags` from the user message (hashtags, "tag: X", or LLM inference)
    - How to explain match rationale in `search_memos` results ("This note matched because…")
    - How to use `promote_memo` (requires `memo_id` — call `search_memos` or `list_memos` first if unspecified)
  - Estimate: 1h ±0.25h | Priority: H
  - Acceptance: No test for prompt text content; verified by manual smoke test (see Phase E)
  - Dependencies: C1

### Phase D: Tests (Day 3, afternoon + Day 4)

- [ ] **D1**: `tests/memos.test.ts` — unit tests for `src/memos.ts`
  - Test cases:
    - `saveMemo()` inserts row; `getMemo()` retrieves exact content
    - `listMemos()` returns newest-first, respects `status` filter
    - `keywordSearchMemos()` returns results matching FTS5 query, excludes archived
    - FTS5 triggers: insert a memo, search immediately finds it; update memo, search finds updated text; delete memo row, search no longer finds it
    - `updateMemoEmbedding()` stores blob; `loadEmbeddingsForUser()` deserializes Float32Array correctly
    - `archiveMemos()` by tag changes status to `archived` only for matching rows, returns correct count
    - `archiveMemos()` by date archives only memos older than the given date
    - Per-user isolation: `listMemos(userA)` never returns userB's memos
  - Estimate: 3h ±1h | Priority: H
  - Dependencies: A5

- [ ] **D2**: `tests/embeddings.test.ts` — unit tests for `src/embeddings.ts`
  - Test cases:
    - `getEmbedding()` calls `embed()` with correct params and returns array
    - `getEmbedding()` rethrows `embed()` errors
    - `tryGetEmbedding()` returns `null` when `embed()` throws (no uncaught exception)
  - Estimate: 0.5h | Priority: H
  - Dependencies: A6

- [ ] **D3**: `tests/tools/memo-tools.test.ts` — unit tests for all five tools
  - Test cases per tool as identified in B1–B5 acceptance criteria
  - Shared test fixtures: in-memory DB, mock `embed()`, mock task provider
  - Estimate: 3h ±1h | Priority: H
  - Dependencies: B1–B5

- [ ] **D4**: Update `package.json` test script paths to include new test files
  - Estimate: 0.25h | Priority: H
  - Dependencies: D1–D3

### Phase E: Smoke Testing & Acceptance Validation (Day 4–5)

- [ ] **E1**: Manual smoke test — US1 (quick memo capture)
  - Send "note: lease renewal deadline is June 15" to the bot
  - Verify bot confirms save, echoes content, shows any extracted tags
  - Dependencies: C1, C2

- [ ] **E2**: Manual smoke test — US2 (routing)
  - Send "remember that the dev server needs 8 GB RAM" — verify `save_memo` called, not `create_task`
  - Send "create a task to upgrade the dev server RAM" — verify `create_task` called, not `save_memo`
  - Dependencies: C2

- [ ] **E3**: Manual smoke test — US3 (keyword search)
  - Save multiple memos, one tagged `landlord` with "lease renewal" text
  - Ask "find my notes tagged landlord" — verify correct memos returned
  - Ask "search my notes for lease" — verify text-match results
  - Dependencies: B2, C2

- [ ] **E4**: Manual smoke test — US4 (semantic recall)
  - Save "the apartment contract ends in June — need to act before May"
  - Ask "any notes on housing deadlines?" — verify memo surfaces with explanation
  - Ask with `embedding_model` config unset — verify FTS5 fallback works
  - Dependencies: B2, C2

- [ ] **E5**: Manual smoke test — US5 (promote memo to task)
  - Identify saved memo by ID or recent list
  - Ask "turn my lease renewal note into a task with a June 15 due date"
  - Verify task appears in tracker with correct title and date
  - Dependencies: B5, C2

- [ ] **E6**: Manual smoke test — US6 (recent memos)
  - Ask "show my recent notes" — verify newest-first list with timestamps
  - Dependencies: B3, C2

- [ ] **E7**: Manual smoke test — US7 (archive)
  - Save several memos; ask "archive my lease notes" — verify only matching ones archived
  - Ask "clear out notes older than three months" — verify date-scoped archive runs
  - Dependencies: B4, C2

---

## Risk Assessment Matrix

| Risk                                                                        | Probability | Impact | Mitigation                                                                                                                                               | Owner     |
| --------------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| User's LLM endpoint doesn't support `/embeddings` route                     | Medium      | Medium | Graceful fallback to FTS5 in `search_memos`; `tryGetEmbedding()` returns `null` silently; semantic recall is best-effort                                 | Developer |
| Embedding stored dimension mismatches query vector dimension at search time | Low         | High   | Always deserialize from BLOB at query time (`blob.length / 4` = dim); compare dims before `cosineSimilarity()` call; skip mismatched rows with a warning | Developer |
| FTS5 trigger not firing correctly, causing stale FTS index                  | Low         | Medium | TDD: `tests/memos.test.ts` D1 includes explicit trigger tests (insert → FTS finds it; delete → FTS doesn't)                                              | Developer |
| LLM routes observational messages as tasks instead of memos                 | Medium      | Low    | System prompt routing section (C2) + tool descriptions encode the contract; if user corrects, bot re-routes                                              | Developer |
| `archive_memos` destructive action runs without user consent                | Low         | High   | Apply same `confidence` + confirmation-gate pattern as `archive_task` for date-range archives                                                            | Developer |
| Tag JSON parsing fails on malformed input                                   | Low         | Low    | Tags stored as validated JSON array; tool input schema uses `z.array(z.string())` so only valid arrays reach the DB                                      | Developer |
| Migration `009` conflicts with future migrations                            | Low         | Low    | Migration validator in `migrate.ts` already rejects duplicate prefixes and out-of-order IDs                                                              | Developer |
| Embedding BLOB causes significant DB size growth                            | Low         | Low    | 1536-dim Float32 = 6 KB per memo; 1000 memos = 6 MB — negligible alongside conversation history                                                          | Developer |

---

## File Map

### New files

| File                             | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `src/memos.ts`                   | Memo persistence layer (CRUD, FTS5, embedding storage, archive) |
| `src/embeddings.ts`              | `embed()` wrapper with graceful fallback                        |
| `src/db/migrations/009_memos.ts` | Migration: `memos`, `memos_fts`, FTS5 triggers, `memo_links`    |
| `src/tools/save-memo.ts`         | `save_memo` AI tool                                             |
| `src/tools/search-memos.ts`      | `search_memos` AI tool (semantic + keyword)                     |
| `src/tools/list-memos.ts`        | `list_memos` AI tool                                            |
| `src/tools/archive-memos.ts`     | `archive_memos` AI tool                                         |
| `src/tools/promote-memo.ts`      | `promote_memo` AI tool                                          |
| `tests/memos.test.ts`            | Unit tests for `src/memos.ts`                                   |
| `tests/embeddings.test.ts`       | Unit tests for `src/embeddings.ts`                              |
| `tests/tools/memo-tools.test.ts` | Unit tests for all five memo tools                              |

### Modified files

| File                      | Change                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`        | Add `memos`, `memo_links` Drizzle table definitions and inferred types                               |
| `src/db/index.ts`         | Register `migration009Memos` in `MIGRATIONS` array                                                   |
| `src/types/config.ts`     | Add `'embedding_model'` to `ConfigKey` union and `CONFIG_KEYS` array                                 |
| `src/tools/index.ts`      | Register `save_memo`, `search_memos`, `list_memos`, `archive_memos`, `promote_memo` in `makeTools()` |
| `src/llm-orchestrator.ts` | Add MEMOS routing section to system prompt                                                           |
| `package.json`            | Add new test directories to `test` and `test:coverage` scripts if necessary                          |

---

## Quality Gates

**Before marking Phase 06 complete:**

- [ ] `bun run check` passes on all modified and new files (`lint`, `typecheck`, `format:check`, `knip`, `test`, `security`)
- [ ] No `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or `oxlint-disable` comments anywhere
- [ ] `tests/memos.test.ts` covers: insert, retrieve, list ordering, FTS5 keyword search, FTS5 trigger sync (insert/update/delete), embedding BLOB round-trip, archive by tag, archive by date, per-user isolation
- [ ] `tests/tools/memo-tools.test.ts` covers: each tool's happy path and at least one failure/edge case
- [ ] `bun test` exits 0
- [ ] Database migration `009` runs cleanly against an empty DB and an existing populated DB (no data loss)
- [ ] Semantic search falls back silently to FTS5 when `embed()` throws (test via mock in D2/D3)
- [ ] Manual smoke tests E1–E7 all pass against a live LLM endpoint

---

## Out of Scope

| Item                                         | Reason                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Memo sharing between users                   | Phase 06 is a personal memo store; group context is covered by Phase group-chat work       |
| Local ONNX embeddings                        | Adds native dependency and 80–100 MB model files; remote embeddings cover the use case     |
| Memo versioning / edit history               | Not required by any US1–US7 acceptance criteria                                            |
| Scheduled / automatic expiry of memos by TTL | US7 covers manual archive; automatic scheduled cleanup is Phase 07+ (proactive assistance) |
| Dedicated `/memo` command prefix             | US2 explicitly requires the LLM to route without special command syntax                    |
| sqlite-vec or any SQLite extension           | Bun extension loading on Linux is unresolved; Option A covers our scale without it         |

---

## Dependencies Between Tasks

```
A1 (config key)
  └─ A2 (migration)
       └─ A3 (register migration)
       └─ A4 (Drizzle schema)
            └─ A5 (memos.ts persistence)
                 └─ B1 (save-memo tool)
                 └─ B2 (search-memos tool) ← A6 (embeddings.ts)
                 └─ B3 (list-memos tool)
                 └─ B4 (archive-memos tool)
                 └─ B5 (promote-memo tool)
                      └─ C1 (register tools)
                           └─ C2 (system prompt)
                                └─ E1–E7 (smoke tests)

A6 (embeddings.ts) ← independent, can be done in parallel with A1–A5
D1–D3 (tests) ← written alongside or immediately after B1–B5

```

---

## Appendix: `embed()` API Usage

The Vercel AI SDK `embed()` function (already in the project) accepts:

```typescript
import { embed } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

const provider = createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })
const { embedding } = await embed({
  model: provider.textEmbeddingModel(modelName),
  value: text,
})
// embedding: number[]
```

The `cosineSimilarity()` function:

```typescript
import { cosineSimilarity } from 'ai'
const score = cosineSimilarity(vecA, vecB) // number in [-1, 1]
```

Both functions are already exported from `ai` ^6.0.116 — no new imports from external packages are needed.
