# Drizzle ORM Migration Plan

> **Using writing-plans skill** to create implementation plan for migrating from plain SQL to Drizzle ORM.

**Goal:** Migrate all plain SQL queries in the papai codebase to Drizzle ORM with Bun SQLite adapter, providing type-safe database operations and improved developer experience.

**Architecture:** Replace raw SQL with Drizzle ORM schema definitions, generated migrations, and type-safe query builders. Keep existing database file and migrate data seamlessly.

**Tech Stack:** Drizzle ORM (bun-sqlite), drizzle-kit for migrations

---

## Current State Analysis

### Tables (from migrations 001-007)

1. **config** - Legacy config table (will be removed after user_config migration)
2. **users** - User authorization with platform_user_id (TEXT PRIMARY KEY), username, added_at, added_by, kaneo_workspace_id
3. **user_config** - Per-user config (user_id TEXT, key TEXT, value TEXT) - composite PK
4. **conversation_history** - Message history (user_id TEXT PRIMARY KEY, messages TEXT)
5. **memory_summary** - Memory summaries (user_id TEXT PRIMARY KEY, summary TEXT, updated_at TEXT)
6. **memory_facts** - Memory facts (user_id TEXT, identifier TEXT, title TEXT, url TEXT, last_seen TEXT) - composite PK
7. **version_announcements** - Version tracking (version TEXT PRIMARY KEY, announced_at TEXT)

### Files Using Raw SQL

- `src/db/index.ts` - Database initialization with WAL mode
- `src/db/migrate.ts` - Migration runner
- `src/db/migrations/*.ts` - 7 migration files
- `src/users.ts` - User CRUD operations
- `src/cache-db.ts` - Background sync operations (history, summary, facts, config, workspace)
- `src/history.ts` - clearHistory function
- `src/memory.ts` - clearSummary, clearFacts functions

---

## Task 1: Install Drizzle ORM Dependencies

**Files:**

- Modify: `package.json`

**Step 1: Add dependencies**

```bash
bun add drizzle-orm
bun add -d drizzle-kit
```

**Expected:** `drizzle-orm` added to dependencies, `drizzle-kit` added to devDependencies.

**Step 2: Commit**

```bash
git add package.json bun.lock
# or package-lock.json if exists
git commit -m "deps: add drizzle-orm and drizzle-kit"
```

---

## Task 2: Create Drizzle Configuration

**Files:**

- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`

**Step 1: Create drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/drizzle-migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env['DB_PATH'] ?? 'papai.db',
  },
})
```

**Step 2: Create schema.ts with all tables**

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  platformUserId: text('platform_user_id').primaryKey(),
  username: text('username').unique(),
  addedAt: text('added_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  addedBy: text('added_by').notNull(),
  kaneoWorkspaceId: text('kaneo_workspace_id'),
})

export const userConfig = sqliteTable(
  'user_config',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.key] }),
  }),
)

export const conversationHistory = sqliteTable('conversation_history', {
  userId: text('user_id').primaryKey(),
  messages: text('messages').notNull(),
})

export const memorySummary = sqliteTable('memory_summary', {
  userId: text('user_id').primaryKey(),
  summary: text('summary').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const memoryFacts = sqliteTable(
  'memory_facts',
  {
    userId: text('user_id').notNull(),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull().default(''),
    lastSeen: text('last_seen').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.identifier] }),
  }),
)

export const versionAnnouncements = sqliteTable('version_announcements', {
  version: text('version').primaryKey(),
  announcedAt: text('announced_at').notNull(),
})
```

**Step 3: Run lint and format**

```bash
bun run lint
bun run format
```

**Step 4: Commit**

```bash
git add drizzle.config.ts src/db/schema.ts
git commit -m "chore: add drizzle config and schema definitions"
```

---

## Task 3: Create Drizzle Database Client

**Files:**

- Create: `src/db/drizzle.ts`

**Step 1: Create drizzle client wrapper**

```typescript
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import * as schema from './schema.js'

const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined

export const getDrizzleDb = () => {
  if (dbInstance === undefined) {
    const sqlite = new Database(DB_PATH)
    // WAL mode and foreign keys are set in existing getDb, keep for compatibility
    sqlite.run('PRAGMA journal_mode=WAL')
    sqlite.run('PRAGMA foreign_keys=ON')
    dbInstance = drizzle(sqlite, { schema })
  }
  return dbInstance
}

export const closeDrizzleDb = () => {
  if (dbInstance !== undefined) {
    // Note: bun:sqlite Database doesn't have a close method that's easily accessible
    // The existing closeDb handles this
    dbInstance = undefined
  }
}
```

**Step 2: Commit**

```bash
git add src/db/drizzle.ts
git commit -m "feat: add drizzle database client wrapper"
```

---

## Task 4: Migrate src/users.ts to Drizzle

**Files:**

- Modify: `src/users.ts`

**Step 1: Update imports and queries**

```typescript
import { eq, or } from 'drizzle-orm'
import { getCachedWorkspace, setCachedWorkspace } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { users, userConfig } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'users' })

interface UserRecord {
  platform_user_id: string
  username: string | null
  added_at: string
  added_by: string
}

export function addUser(userId: string, addedBy: string, username?: string): void {
  log.debug({ userId, addedBy, hasUsername: username !== undefined }, 'addUser called')
  const db = getDrizzleDb()

  db.insert(users)
    .values({
      platformUserId: userId,
      username: username ?? null,
      addedBy,
    })
    .onConflictDoUpdate({
      target: users.platformUserId,
      set: { username: username ?? null },
    })
    .run()

  log.info({ userId, addedBy, hasUsername: username !== undefined }, 'User added')
}

export function removeUser(identifier: string): void {
  log.debug({ identifier }, 'removeUser called')
  const db = getDrizzleDb()

  db.delete(users)
    .where(or(eq(users.username, identifier), eq(users.platformUserId, identifier)))
    .run()

  log.info({ identifier }, 'User removed')
}

export function isAuthorized(userId: string): boolean {
  log.debug({ userId }, 'isAuthorized called')
  const db = getDrizzleDb()

  const row = db
    .select({ platformUserId: users.platformUserId })
    .from(users)
    .where(eq(users.platformUserId, userId))
    .get()

  return row !== undefined
}

export function resolveUserByUsername(userId: string, username: string): boolean {
  log.debug({ userId, username }, 'resolveUserByUsername called')
  const db = getDrizzleDb()

  const row = db.select({ platformUserId: users.platformUserId }).from(users).where(eq(users.username, username)).get()

  if (row === undefined) return false
  if (row.platformUserId === userId) return true

  db.update(users).set({ platformUserId: userId }).where(eq(users.username, username)).run()

  log.info({ userId, username }, 'User platform_user_id resolved from username')
  return true
}

export function listUsers(): UserRecord[] {
  log.debug('listUsers called')
  const db = getDrizzleDb()

  return db
    .select({
      platform_user_id: users.platformUserId,
      username: users.username,
      added_at: users.addedAt,
      added_by: users.addedBy,
    })
    .from(users)
    .all()
}

export function getKaneoWorkspace(userId: string): string | null {
  log.debug({ userId }, 'getKaneoWorkspace called')
  return getCachedWorkspace(userId)
}

export function setKaneoWorkspace(userId: string, workspaceId: string): void {
  log.debug({ userId }, 'setKaneoWorkspace called')
  setCachedWorkspace(userId, workspaceId)
  log.info({ userId }, 'Kaneo workspace ID stored (DB sync in background)')
}
```

**Step 2: Run typecheck and lint**

```bash
bun run typecheck
bun run lint
```

**Step 3: Commit**

```bash
git add src/users.ts
git commit -m "refactor: migrate users.ts to drizzle orm"
```

---

## Task 5: Migrate src/cache-db.ts to Drizzle

**Files:**

- Modify: `src/cache-db.ts`

**Step 1: Update sync functions**

```typescript
import { eq, and, sql } from 'drizzle-orm'
import { getDrizzleDb } from './db/drizzle.js'
import { conversationHistory, memorySummary, memoryFacts, userConfig, users } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'cache-db' })

export function syncHistoryToDb(userId: string, messages: unknown[]): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(conversationHistory)
        .values({ userId, messages: JSON.stringify(messages) })
        .onConflictDoUpdate({
          target: conversationHistory.userId,
          set: { messages: JSON.stringify(messages) },
        })
        .run()
      log.debug({ userId, messageCount: messages.length }, 'History synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync history to DB',
      )
    }
  })
}

export function syncSummaryToDb(userId: string, summary: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(memorySummary)
        .values({ userId, summary, updatedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: memorySummary.userId,
          set: { summary, updatedAt: new Date().toISOString() },
        })
        .run()
      log.debug({ userId, summaryLength: summary.length }, 'Summary synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync summary to DB',
      )
    }
  })
}

export function syncFactToDb(
  userId: string,
  fact: { identifier: string; title: string; url: string },
  now: string,
): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()

      db.transaction((tx) => {
        // Insert or update the fact
        tx.insert(memoryFacts)
          .values({
            userId,
            identifier: fact.identifier,
            title: fact.title,
            url: fact.url,
            lastSeen: now,
          })
          .onConflictDoUpdate({
            target: [memoryFacts.userId, memoryFacts.identifier],
            set: { lastSeen: now },
          })
          .run()

        // Keep only 50 most recent facts per user
        tx.delete(memoryFacts)
          .where(
            and(
              eq(memoryFacts.userId, userId),
              sql`${memoryFacts.identifier} NOT IN (
                SELECT identifier FROM memory_facts 
                WHERE user_id = ${userId} 
                ORDER BY last_seen DESC LIMIT 50
              )`,
            ),
          )
          .run()
      })

      log.debug({ userId, identifier: fact.identifier }, 'Fact synced to DB')
    } catch (error) {
      log.error({ userId, error: error instanceof Error ? error.message : String(error) }, 'Failed to sync fact to DB')
    }
  })
}

export function syncConfigToDb(userId: string, key: string, value: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(userConfig)
        .values({ userId, key, value })
        .onConflictDoUpdate({
          target: [userConfig.userId, userConfig.key],
          set: { value },
        })
        .run()
      log.debug({ userId, key }, 'Config synced to DB')
    } catch (error) {
      log.error(
        { userId, key, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync config to DB',
      )
    }
  })
}

export function syncWorkspaceToDb(userId: string, workspaceId: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.update(users).set({ kaneoWorkspaceId: workspaceId }).where(eq(users.platformUserId, userId)).run()
      log.debug({ userId }, 'Workspace synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync workspace to DB',
      )
    }
  })
}
```

**Step 2: Run typecheck and lint**

```bash
bun run typecheck
bun run lint
```

**Step 3: Commit**

```bash
git add src/cache-db.ts
git commit -m "refactor: migrate cache-db.ts to drizzle orm"
```

---

## Task 6: Migrate src/history.ts to Drizzle

**Files:**

- Modify: `src/history.ts`

**Step 1: Update clearHistory function**

```typescript
import { eq } from 'drizzle-orm'
import { type ModelMessage } from 'ai'
import { getCachedHistory, setCachedHistory, appendToCachedHistory } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { conversationHistory } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'history' })

export function loadHistory(userId: string): readonly ModelMessage[] {
  log.debug({ userId }, 'loadHistory called')
  return getCachedHistory(userId)
}

export function saveHistory(userId: string, messages: readonly ModelMessage[]): void {
  log.debug({ userId, messageCount: messages.length }, 'saveHistory called')
  setCachedHistory(userId, messages)
  log.info({ userId, messageCount: messages.length }, 'History saved to cache (DB sync in background)')
}

export function appendHistory(userId: string, messages: readonly ModelMessage[]): void {
  log.debug({ userId, appendCount: messages.length }, 'appendHistory called')
  appendToCachedHistory(userId, messages)
}

export function clearHistory(userId: string): void {
  log.debug({ userId }, 'clearHistory called')
  setCachedHistory(userId, [])

  const db = getDrizzleDb()
  db.delete(conversationHistory).where(eq(conversationHistory.userId, userId)).run()

  log.info({ userId }, 'History cleared')
}
```

**Step 2: Commit**

```bash
git add src/history.ts
git commit -m "refactor: migrate history.ts to drizzle orm"
```

---

## Task 7: Migrate src/memory.ts to Drizzle

**Files:**

- Modify: `src/memory.ts`

**Step 1: Update clear functions**

```typescript
import { generateText, Output, type LanguageModel, type ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getCachedFacts, getCachedSummary, setCachedSummary, clearCachedFacts, upsertCachedFact } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { memorySummary, memoryFacts } from './db/schema.js'
import { logger } from './logger.js'
import type { MemoryFact } from './types/memory.js'

const log = logger.child({ scope: 'memory' })

// ... existing code ...

export function clearSummary(userId: string): void {
  log.debug({ userId }, 'clearSummary called')
  setCachedSummary(userId, '')

  const db = getDrizzleDb()
  db.delete(memorySummary).where(eq(memorySummary.userId, userId)).run()

  log.info({ userId }, 'Summary cleared')
}

// ... existing code ...

export function clearFacts(userId: string): void {
  log.debug({ userId }, 'clearFacts called')
  clearCachedFacts(userId)

  const db = getDrizzleDb()
  db.delete(memoryFacts).where(eq(memoryFacts.userId, userId)).run()

  log.info({ userId }, 'Facts cleared')
}

// ... rest of file unchanged ...
```

**Step 2: Commit**

```bash
git add src/memory.ts
git commit -m "refactor: migrate memory.ts to drizzle orm"
```

---

## Task 8: Create Migration Strategy for Existing DB

**Files:**

- Create: `src/db/migrate-to-drizzle.ts`

**Step 1: Create one-time migration script**

```typescript
/**
 * One-time migration to ensure Drizzle ORM metadata table exists
 * This should be run once when deploying the Drizzle version
 */
import { Database } from 'bun:sqlite'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'migrate-to-drizzle' })

export function ensureDrizzleMetadata(db: Database): void {
  // Check if drizzle metadata table exists
  const tableExists = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get()

  if (tableExists === null) {
    log.info('Creating Drizzle metadata table')
    db.run(`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        created_at INTEGER
      )
    `)

    // Mark all existing migrations as applied
    // This assumes the database is already at the latest schema version
    const timestamp = Date.now()
    db.run(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, ['initial_baseline', timestamp])

    log.info('Drizzle metadata initialized')
  }
}
```

**Step 2: Commit**

```bash
git add src/db/migrate-to-drizzle.ts
git commit -m "feat: add drizzle metadata migration helper"
```

---

## Task 9: Update src/db/index.ts to Support Drizzle

**Files:**

- Modify: `src/db/index.ts`

**Step 1: Update to expose both raw and drizzle clients**

```typescript
import { Database } from 'bun:sqlite'

import { logger } from '../logger.js'
import { runMigrations } from './migrate.js'
import { migration001Initial } from './migrations/001_initial.js'
import { migration002ConversationHistory } from './migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from './migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from './migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from './migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from './migrations/006_version_announcements.js'
import { migration007PlatformUserId } from './migrations/007_platform_user_id.js'

const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

let dbInstance: Database | undefined

export const getDb = (): Database => {
  if (dbInstance === undefined) {
    dbInstance = new Database(DB_PATH)
    // WAL mode is set here rather than in migrations because it must be
    // configured per-database-connection, not per-database-file. This ensures
    // WAL is active immediately on first connection, before any migrations run.
    dbInstance.run('PRAGMA journal_mode=WAL')
    dbInstance.run('PRAGMA foreign_keys=ON')
    logger.info({ dbPath: DB_PATH }, 'Database connection created')
  }
  return dbInstance
}

export const closeDb = (): void => {
  if (dbInstance !== undefined) {
    dbInstance.close()
    dbInstance = undefined
    logger.info({ dbPath: DB_PATH }, 'Database connection closed')
  }
}

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
] as const

export const initDb = (): void => {
  runMigrations(getDb(), MIGRATIONS)
}

// Re-export drizzle helpers for convenience
export { getDrizzleDb, closeDrizzleDb } from './drizzle.js'
```

**Step 2: Commit**

```bash
git add src/db/index.ts
git commit -m "chore: update db/index.ts to support drizzle exports"
```

---

## Task 10: Add Indexes via Drizzle Schema

**Files:**

- Modify: `src/db/schema.ts`

**Step 1: Add indexes to schema**

```typescript
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  platformUserId: text('platform_user_id').primaryKey(),
  username: text('username').unique(),
  addedAt: text('added_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  addedBy: text('added_by').notNull(),
  kaneoWorkspaceId: text('kaneo_workspace_id'),
})

export const userConfig = sqliteTable(
  'user_config',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.key] }),
    userIdx: index('idx_user_config_user_id').on(table.userId),
  }),
)

export const conversationHistory = sqliteTable('conversation_history', {
  userId: text('user_id').primaryKey(),
  messages: text('messages').notNull(),
})

export const memorySummary = sqliteTable('memory_summary', {
  userId: text('user_id').primaryKey(),
  summary: text('summary').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const memoryFacts = sqliteTable(
  'memory_facts',
  {
    userId: text('user_id').notNull(),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull().default(''),
    lastSeen: text('last_seen').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.identifier] }),
    userLastSeenIdx: index('idx_memory_facts_user_lastseen').on(table.userId, table.lastSeen),
  }),
)

export const versionAnnouncements = sqliteTable('version_announcements', {
  version: text('version').primaryKey(),
  announcedAt: text('announced_at').notNull(),
})
```

**Step 2: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add database indexes to drizzle schema"
```

---

## Task 11: Update Tests

**Files:**

- Modify: `tests/db/migrate.test.ts`

**Step 1: Update test imports to handle drizzle setup**

The existing migration tests should continue to work since we're keeping the raw SQL migration system intact. The Drizzle ORM is layered on top.

**Step 2: Add drizzle-specific tests**

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from '../src/db/schema.js'

describe('Drizzle ORM Integration', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>
  let sqlite: Database

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = drizzle(sqlite, { schema })
  })

  test('should be able to query users table', () => {
    // Test basic Drizzle operations
    const result = db.select().from(schema.users).all()
    expect(result).toEqual([])
  })

  test('should be able to insert and retrieve user', () => {
    db.insert(schema.users)
      .values({
        platformUserId: 'test-user',
        username: 'testuser',
        addedBy: 'admin',
      })
      .run()

    const user = db.select().from(schema.users).get()
    expect(user).toBeDefined()
    expect(user?.platformUserId).toBe('test-user')
  })
})
```

**Step 3: Commit**

```bash
git add tests/db/migrate.test.ts
git commit -m "test: add drizzle orm integration tests"
```

---

## Task 12: Final Cleanup and Verification

**Step 1: Run full test suite**

```bash
bun run typecheck
bun run lint
bun run test
```

**Step 2: Verify no raw SQL remains**

```bash
# Check for any remaining db.run, db.query, etc. in src (excluding migrations)
grep -r "db\.run\|db\.query\|db\.prepare" src/ --include="*.ts" | grep -v "migrations/" | grep -v "migrate.ts"
```

**Expected:** No results (or only in db/index.ts which is expected)

**Step 3: Create PR**

```bash
git push origin drizzle-migration
git log --oneline HEAD~12..HEAD
```

---

## Rollback Plan

If issues occur:

1. The raw `getDb()` client is still available in `src/db/index.ts`
2. Original migration files are preserved
3. Database schema is compatible - Drizzle ORM uses the same SQLite tables

To rollback:

- Revert commits in reverse order
- Restore original files from git
- No database migration needed since schema is identical

---

## Summary

This migration provides:

1. **Type Safety**: All database operations are fully typed
2. **Developer Experience**: Auto-completion and IntelliSense for table/column names
3. **Maintainability**: Schema defined in one place (schema.ts)
4. **Consistency**: Query builder API instead of string concatenation
5. **Future-Proof**: Easy to add new tables or modify existing ones

The migration is non-breaking - existing database files work without modification.
