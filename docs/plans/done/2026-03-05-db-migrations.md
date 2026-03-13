# Database Migration Framework

**Goal:** Add a lightweight, zero-dependency migration runner so that schema changes for Phase 3
(conversation history persistence) can be applied deterministically on startup without data loss and with a
clear audit trail.

**Tech Stack:** TypeScript, Bun, `bun:sqlite` (already in use — no new runtime deps)

**Date:** 2026-03-05

---

## Current State

### Existing Tables

| Table    | File            | DDL                                                                             |
| -------- | --------------- | ------------------------------------------------------------------------------- |
| `config` | `src/config.ts` | `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)` |

Schema is applied inline at module-load time with `CREATE TABLE IF NOT EXISTS`. There is no version
tracking, no migration history, and no way to apply safe `ALTER TABLE` changes to an existing database.

### Phase 3 Required Tables

From `docs/plans/2026-03-05-conversation-history-persistence.md`:

```sql
-- Tier 1: verbatim sliding window
CREATE TABLE IF NOT EXISTS conversation_history (
  user_id  INTEGER PRIMARY KEY,
  messages TEXT NOT NULL
);

-- Tier 2: rolling prose summary
CREATE TABLE IF NOT EXISTS memory_summary (
  user_id    INTEGER PRIMARY KEY,
  summary    TEXT NOT NULL,
  updated_at TEXT NOT NULL   -- ISO-8601 UTC
);

-- Tier 2: structured entity facts
CREATE TABLE IF NOT EXISTS memory_facts (
  user_id     INTEGER NOT NULL,
  identifier  TEXT    NOT NULL,  -- e.g. "ENG-42" or "proj:Backend"
  title       TEXT    NOT NULL,
  url         TEXT    NOT NULL DEFAULT '',
  last_seen   TEXT    NOT NULL,  -- ISO-8601 UTC
  PRIMARY KEY (user_id, identifier)
);
```

---

## Design Decisions

| Decision             | Chosen                                                               | Rejected alternatives                                                                                                                        |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration tooling    | Custom runner (zero new deps)                                        | Drizzle ORM (brings full ORM + codegen), Kysely (query builder, schema-only migrations), umzug/db-migrate (Node.js runtimes, not Bun-native) |
| Migration files      | Numbered `.ts` migration modules in `src/db/migrations/`             | SQL files (no type safety, no imports); embedded strings in a single file (hard to review diffs)                                             |
| Version tracking     | `migrations` meta-table inside `papai.db`                            | Separate `.migrations` file (drift risk between file and db); in-memory only (no persistence)                                                |
| Startup integration  | `runMigrations()` called once in `src/index.ts` before `bot.start()` | Lazy per-module DDL (current approach: scattered, can't do ALTER TABLE safely)                                                               |
| Migration interface  | `{ id: string; up: (db: Database) => void }`                         | Class-based; async (SQLite is synchronous in bun, async adds complexity for no gain)                                                         |
| Transaction strategy | Each migration wrapped in a single transaction                       | All migrations in one transaction (a partial failure rolls back everything, not just the bad migration)                                      |
| Failure handling     | `process.exit(1)` on migration failure                               | Warn and continue (unsafe — app could run with wrong schema); retry loop (schema errors are not transient)                                   |
| WAL mode             | Enabled once by migration 001                                        | Per-module PRAGMA (duplicated, order-dependent)                                                                                              |

---

## Architecture

```
src/
  db/
    migrate.ts          ← runner: reads, filters, applies, records
    migrations/
      001_initial.ts    ← config table + WAL pragma
      002_conversation_history.ts  ← Phase 3 tables
```

```
papai.db
  config               ← existing data
  migrations           ← NEW: tracks applied migration IDs
  conversation_history ← added by 002
  memory_summary       ← added by 002
  memory_facts         ← added by 002
```

---

## Task Breakdown

### Task 1 — Create `src/db/migrate.ts`

**File:** `src/db/migrate.ts` (new)

Interface and runner contract:

```typescript
export interface Migration {
  readonly id: string // e.g. "001_initial"
  up(db: Database): void
}
```

Runner logic (`runMigrations(db: Database, migrations: readonly Migration[]): void`):

1. Create `migrations` table if it does not exist:
   ```sql
   CREATE TABLE IF NOT EXISTS migrations (
     id         TEXT    PRIMARY KEY,
     applied_at TEXT    NOT NULL   -- ISO-8601 UTC
   )
   ```
2. Query all already-applied IDs: `SELECT id FROM migrations`
3. Filter input list to those not yet applied, preserving their original order.
4. For each pending migration:
   a. Begin a transaction.
   b. Call `migration.up(db)`.
   c. Insert `(id, appliedAt)` into `migrations`.
   d. Commit. On any error: rollback, log `logger.error`, rethrow.
5. If all succeed, log `logger.info` with the count of applied migrations.
6. **No return value** — callers rely on the error throw + process.exit for failure semantics.

**Tests** (`tests/db/migrate.test.ts`):

- Applies pending migrations in order.
- Skips already-applied migrations.
- Rolls back on failure and rethrows.
- Is idempotent (calling twice applies nothing the second time).

---

### Task 2 — Create `src/db/migrations/001_initial.ts`

**File:** `src/db/migrations/001_initial.ts` (new)

Captures the current schema as the baseline and enables WAL mode:

```typescript
export const migration001Initial: Migration = {
  id: '001_initial',
  up(db) {
    db.run('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  },
}
```

`CREATE TABLE IF NOT EXISTS` is idempotent — safe to run against a database that already has the table.

**Note:** WAL mode (`PRAGMA journal_mode=WAL`) is configured in `src/db/index.ts` at connection time, not inside migrations. PRAGMAs cannot run inside transactions, and each migration is wrapped in a transaction.

---

### Task 3 — Create `src/db/migrations/002_conversation_history.ts`

**File:** `src/db/migrations/002_conversation_history.ts` (new)

```typescript
export const migration002ConversationHistory: Migration = {
  id: '002_conversation_history',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        user_id  INTEGER PRIMARY KEY,
        messages TEXT NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS memory_summary (
        user_id    INTEGER PRIMARY KEY,
        summary    TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS memory_facts (
        user_id     INTEGER NOT NULL,
        identifier  TEXT    NOT NULL,
        title       TEXT    NOT NULL,
        url         TEXT    NOT NULL DEFAULT '',
        last_seen   TEXT    NOT NULL,
        PRIMARY KEY (user_id, identifier)
      )
    `)
  },
}
```

---

### Task 4 — Create `src/db/index.ts`

**File:** `src/db/index.ts` (new)

Owns the single shared `Database` instance and the ordered migration list. All other modules
import `db` from here instead of opening their own connection.

```typescript
import { Database } from 'bun:sqlite'
import { runMigrations } from './migrate.js'
import { migration001Initial } from './migrations/001_initial.js'
import { migration002ConversationHistory } from './migrations/002_conversation_history.js'

export const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'
export const db = new Database(DB_PATH)

const MIGRATIONS = [migration001Initial, migration002ConversationHistory] as const

export function initDb(): void {
  runMigrations(db, MIGRATIONS)
}
```

Exposes `initDb()` as the single startup hook. Centralises `DB_PATH` resolution and the `Database`
instance — no module opens a second connection.

---

### Task 5 — Update `src/index.ts`

**File:** `src/index.ts` (existing)

Call `initDb()` right after the env-var validation block, before `bot.start()`. If migrations fail,
`runMigrations` throws and `process.exit(1)` is called from the catch:

```typescript
import { initDb } from './db/index.js'
// ...
try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}
```

---

### Task 6 — Update `src/config.ts`

**File:** `src/config.ts` (existing)

- Remove the inline `new Database(...)` and `db.run('CREATE TABLE IF NOT EXISTS config ...')` calls.
- Import `db` from `'./db/index.js'` instead.
- Remove `DB_PATH` constant (now lives in `src/db/index.ts`).
- All `db.run` / `db.query` calls remain unchanged.

Before (lines 1–21):

```typescript
import { Database } from 'bun:sqlite'
// ...
const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'
const db = new Database(DB_PATH)
db.run('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
```

After:

```typescript
import { db } from './db/index.js'
// (remove DB_PATH, remove new Database, remove CREATE TABLE)
```

---

### Task 7 — Update `src/config.test.ts`

**File:** `src/config.test.ts` (existing)

The test currently mocks `bun:sqlite` before importing `config.ts`. After the refactor, `config.ts`
imports `db` from `./db/index.ts`, so the mock target shifts:

- Add a `mock.module('./db/index.js', ...)` mock that returns a `{ db: MockDatabase }` shaped object.
- Remove (or keep as a no-op) the `bun:sqlite` mock — `config.ts` no longer imports it directly.

The `MockDatabase` class structure remains the same; only the mock target changes.

---

### Task 8 — Create `tests/db/migrate.test.ts`

**File:** `tests/db/migrate.test.ts` (new)

Tests use an **in-memory SQLite database** (`new Database(':memory:')`) so they are fast, isolated,
and leave no files on disk. Each test gets a fresh `Database` instance via `beforeEach`.

```typescript
import { Database } from 'bun:sqlite'
import { describe, test, expect, beforeEach } from 'bun:test'
import { runMigrations, type Migration } from './migrate.js'
```

**Test cases:**

1. **Applies pending migrations in order**
   - Provide two migrations. Assert both run sequentially and their effects (table creation) are
     visible in the DB. Assert `SELECT id FROM migrations` returns both IDs in insertion order.

2. **Skips already-applied migrations**
   - Pre-insert one migration ID into the `migrations` table. Call `runMigrations` with both
     migrations. Assert the first migration's `up` function is **not** called (use a spy / counter),
     and the second one is applied exactly once.

3. **Rolls back on failure and rethrows**
   - Provide a migration whose `up` throws. Assert `runMigrations` throws. Assert the failed
     migration ID is **not** recorded in the `migrations` table (transaction rolled back). Assert any
     side effects from `up` that ran before the throw are also absent.

4. **Is idempotent — second call applies nothing**
   - Call `runMigrations` twice with the same migration list. Assert the second call is a no-op:
     `up` is called exactly once total, `migrations` table still has exactly N rows.

5. **Handles empty migration list**
   - Call `runMigrations` with `[]`. Assert no errors are thrown and the `migrations` table exists
     but is empty.

**Note on mocking:** Because tests use a real in-memory `Database` passed directly to `runMigrations`,
no `bun:sqlite` mock is needed. The logger can be left to emit or silenced with a `mock.module` on
`'../logger.js'` if log noise is undesirable.

---

## Ordering Requirement

Migrations in the `MIGRATIONS` array **must always be ordered by their numeric prefix**. A new
migration is always appended to the end. Existing migration IDs and their `up` functions must never
be edited after they have been applied to any database — create a new migration instead.

---

## File Map After Implementation

```
src/
  db/
    index.ts
    migrate.ts
    migrations/
      001_initial.ts
      002_conversation_history.ts
    migrate.test.ts          ← tests for migrate.ts (in tests/ per project convention)
  config.ts                  ← uses db from src/db/index.ts
  config.test.ts             ← mock target updated (Task 7)
  index.ts                   ← calls initDb() before bot.start()
```

---

## Risk Assessment

| Risk                                                                                        | Probability | Impact | Mitigation                                                                  |
| ------------------------------------------------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------- |
| Existing `papai.db` doesn't have a `migrations` table, so 001_initial re-runs on first boot | High        | Low    | `CREATE TABLE IF NOT EXISTS` in `up()` is idempotent — no data loss         |
| Two modules open separate `Database` instances to same file causing WAL conflicts           | Medium      | Medium | Task 4 owns the single `db` instance; all modules import from it            |
| Migration order wrong (e.g. 002 before 001)                                                 | Low         | Medium | `MIGRATIONS` array is the single source of order, reviewed in code review   |
| Mock target in `config.test.ts` breaks after refactor                                       | High        | Low    | Task 7 explicitly updates the mock; tests serve as the verification gate    |
| Future migration edits an already-applied migration                                         | Low         | High   | Documented rule: never edit applied migrations; CI tests against a fresh DB |

---

## Quality Gates

- [ ] `bun test` passes for `src/db/migrate.test.ts` (all 5 test cases)
- [ ] `bun test` passes for `src/config.test.ts` (mock target updated)
- [ ] `bun lint` clean on all new and modified files
- [ ] `bun run start` boots without errors against an existing `papai.db` (upgrade path)
- [ ] `bun run start` boots without errors against a fresh empty database (clean install)
- [ ] `SELECT * FROM migrations` in the live DB shows `001_initial` and `002_conversation_history`
