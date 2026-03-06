# Multi-User Support with Per-User Authorization

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow multiple Telegram users to use the bot, each with their own Linear/LLM credentials and isolated conversation history.

**Architecture:** The current single-user model (`TELEGRAM_USER_ID` env var + global config table) is replaced with a `users` SQLite table for authorization and a `user_config` table for per-user credentials. The original `TELEGRAM_USER_ID` becomes the admin user who can add/remove other users. Each user's `/set` and `/config` commands operate on their own credentials. Conversation history is already keyed by userId — no changes needed there.

**Tech Stack:** Bun, Grammy, SQLite (`bun:sqlite`), Zod v4, pino

---

## Database Schema

```sql
-- Authorized users
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by INTEGER NOT NULL
);

-- Per-user configuration (replaces global config table)
CREATE TABLE IF NOT EXISTS user_config (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
```

## Migration Strategy

The migration is split into two phases:

### Phase 1: Schema Migration (Database-level)

Migration `003_multiuser_support.ts` creates the new tables:

- `users` table for authorization
- `user_config` table for per-user credentials
- Index on `user_config(user_id)` for efficient lookups

**File:** `src/db/migrations/003_multiuser_support.ts`

### Phase 2: Data Migration (Runtime)

Module `src/migrate.ts` handles runtime data migration:

- Seeds admin user (from `TELEGRAM_USER_ID` env var) into `users` table
- Copies existing rows from legacy `config` table to `user_config` scoped to admin
- Uses `INSERT OR IGNORE` to avoid overwriting existing data
- Idempotent: safe to run multiple times

**File:** `src/migrate.ts`

The old `config` table is left in place (not dropped) to avoid data loss — it simply becomes unused after migration.

---

### Task 1: Create `src/users.ts` — user store module

**Files:**

- Create: `src/users.ts`
- Create: `tests/users.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/users.test.ts
import { mock, describe, expect, test, beforeEach } from 'bun:test'

const store = {
  users: new Map<number, { telegram_id: number; username: string | null; added_at: string; added_by: number }>(),
}

const mockResult = mock.module('bun:sqlite', () => ({
  Database: class MockDatabase {
    run(sql: string, params?: (string | number)[]): void {
      if (sql.includes('INSERT INTO users') && params !== undefined) {
        const hasUsername = params.length >= 3 && params[2] !== undefined
        store.users.set(params[0] as number, {
          telegram_id: params[0] as number,
          username: hasUsername ? (params[1] as string) : null,
          added_at: new Date().toISOString(),
          added_by: hasUsername ? (params[2] as number) : (params[1] as number),
        })
      }
      if (sql.includes('DELETE FROM users') && params !== undefined) {
        if (typeof params[0] === 'string') {
          // Delete by username - find and remove
          for (const [id, user] of store.users) {
            if (user.username === params[0]) {
              store.users.delete(id)
              break
            }
          }
        } else {
          store.users.delete(params[0] as number)
        }
      }
    }

    query(sql: string): {
      get: (...args: (string | number)[]) => Record<string, unknown> | null
      all: () => Array<Record<string, unknown>>
    } {
      if (sql.includes('SELECT * FROM users WHERE telegram_id')) {
        return {
          get: (id: string | number): Record<string, unknown> | null => {
            const user = store.users.get(id as number)
            return user ?? null
          },
          all: (): Array<Record<string, unknown>> => [],
        }
      }
      if (sql.includes('SELECT telegram_id, username, added_at, added_by FROM users')) {
        return {
          get: (): null => null,
          all: (): Array<Record<string, unknown>> => Array.from(store.users.values()),
        }
      }
      if (sql.includes('SELECT * FROM users WHERE username')) {
        return {
          get: (username: string | number): Record<string, unknown> | null => {
            for (const user of store.users.values()) {
              if (user.username === username) {
                return user
              }
            }
            return null
          },
          all: (): Array<Record<string, unknown>> => [],
        }
      }
      return { get: (): null => null, all: (): Array<Record<string, unknown>> => [] }
    }
  },
}))

if (mockResult instanceof Promise) {
  mockResult.catch(() => {})
}

import { addUser, removeUser, isAuthorized, isAuthorizedByUsername, listUsers } from '../src/users.js'

describe('addUser', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('adds a user', () => {
    addUser(111, 999)
    expect(store.users.has(111)).toBe(true)
    expect(store.users.get(111)?.added_by).toBe(999)
  })
})

describe('removeUser', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('removes a user', () => {
    addUser(111, 999)
    removeUser(111)
    expect(store.users.has(111)).toBe(false)
  })
})

describe('isAuthorized', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('returns true for authorized user', () => {
    addUser(111, 999)
    expect(isAuthorized(111)).toBe(true)
  })

  test('returns false for unknown user', () => {
    expect(isAuthorized(222)).toBe(false)
  })
})

describe('isAuthorizedByUsername', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('returns true for authorized user by username', () => {
    addUser(111, 999, 'testuser')
    expect(isAuthorizedByUsername('testuser')).toBe(true)
  })

  test('returns false for unknown username', () => {
    expect(isAuthorizedByUsername('unknown')).toBe(false)
  })
})

describe('listUsers', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('returns all users', () => {
    addUser(111, 999)
    addUser(222, 999)
    const users = listUsers()
    expect(users).toHaveLength(2)
  })

  test('returns empty array when no users', () => {
    expect(listUsers()).toHaveLength(0)
  })

  test('includes username when set', () => {
    addUser(111, 999, 'testuser')
    const users = listUsers()
    expect(users[0]?.username).toBe('testuser')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/users.test.ts`
Expected: FAIL — module `../src/users.js` does not exist

**Step 3: Write the implementation**

```typescript
// src/users.ts
import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'users' })

const db = getDb()

export function addUser(telegramId: number, addedBy: number, username?: string): void {
  log.debug({ telegramId, addedBy, username }, 'addUser called')
  if (username !== undefined) {
    db.run(
      'INSERT INTO users (telegram_id, username, added_by) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username',
      [telegramId, username, addedBy],
    )
  } else {
    db.run('INSERT INTO users (telegram_id, added_by) VALUES (?, ?) ON CONFLICT DO NOTHING', [telegramId, addedBy])
  }
  log.info({ telegramId, addedBy, username }, 'User added')
}

export function removeUser(identifier: number | string): void {
  log.debug({ identifier }, 'removeUser called')
  if (typeof identifier === 'string') {
    db.run('DELETE FROM users WHERE username = ?', [identifier])
  } else {
    db.run('DELETE FROM users WHERE telegram_id = ?', [identifier])
  }
  log.info({ identifier }, 'User removed')
}

export function isAuthorized(telegramId: number): boolean {
  log.debug({ telegramId }, 'isAuthorized called')
  const row = db.query<{ telegram_id: number }, [number]>('SELECT * FROM users WHERE telegram_id = ?').get(telegramId)
  return row !== null
}

export function isAuthorizedByUsername(username: string): boolean {
  log.debug({ username }, 'isAuthorizedByUsername called')
  const row = db.query<{ telegram_id: number }, [string]>('SELECT * FROM users WHERE username = ?').get(username)
  return row !== null
}

export interface UserRecord {
  telegram_id: number
  username: string | null
  added_at: string
  added_by: number
}

export function listUsers(): UserRecord[] {
  log.debug('listUsers called')
  return db.query<UserRecord, []>('SELECT telegram_id, username, added_at, added_by FROM users').all()
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/users.test.ts`
Expected: PASS — all 6 tests pass

**Step 5: Commit**

```bash
git add src/users.ts tests/users.test.ts
git commit -m "feat: add users module for multi-user authorization"
```

---

### Task 2: Make config per-user

**Files:**

- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

The global `config` table is replaced by `user_config` keyed on `(user_id, key)`. All public functions gain a `userId: number` parameter.

**Step 1: Update the tests**

Replace the contents of `tests/config.test.ts`. Key changes:

- The mock store is now `Map<string, string>` keyed by `"${userId}:${key}"`
- Every call to `setConfig`, `getConfig`, `getAllConfig` passes a `userId`

```typescript
// tests/config.test.ts
import { mock, describe, expect, test, beforeEach } from 'bun:test'

const store = { data: new Map<string, string>() }

const mockSetupResult = mock.module('bun:sqlite', () => ({
  Database: class MockDatabase {
    run(sql: string, params?: (string | number)[]): void {
      if (sql.includes('INSERT OR REPLACE INTO user_config') && params !== undefined) {
        store.data.set(`${params[0]}:${params[1]}`, params[2] as string)
      }
    }

    query(sql: string): {
      get: (...args: (string | number)[]) => { value: string } | null
      all: (...args: (string | number)[]) => Array<{ key: string; value: string }>
    } {
      if (sql.includes('SELECT value FROM user_config WHERE user_id') && sql.includes('AND key')) {
        return {
          get: (userId: string | number, key: string | number): { value: string } | null => {
            const value = store.data.get(`${userId}:${key}`)
            return value !== undefined ? { value } : null
          },
          all: (): Array<{ key: string; value: string }> => [],
        }
      }
      if (sql.includes('SELECT key, value FROM user_config WHERE user_id')) {
        return {
          get: (): null => null,
          all: (userId: string | number): Array<{ key: string; value: string }> => {
            const prefix = `${userId}:`
            return Array.from(store.data.entries())
              .filter(([k]) => k.startsWith(prefix))
              .map(([k, v]) => ({ key: k.slice(prefix.length), value: v }))
          },
        }
      }
      return { get: (): null => null, all: (): Array<{ key: string; value: string }> => [] }
    }
  },
}))

if (mockSetupResult instanceof Promise) {
  mockSetupResult.catch(() => {})
}

import { CONFIG_KEYS, getAllConfig, getConfig, isConfigKey, maskValue, setConfig } from '../src/config.js'
import type { ConfigKey } from '../src/config.js'

const USER_A = 111
const USER_B = 222

describe('setConfig', () => {
  beforeEach(() => {
    store.data.clear()
  })

  test('stores value for user and key', () => {
    setConfig(USER_A, 'linear_key', 'test-api-key')
    expect(getConfig(USER_A, 'linear_key')).toBe('test-api-key')
  })

  test('updates existing value', () => {
    setConfig(USER_A, 'linear_key', 'old-key')
    setConfig(USER_A, 'linear_key', 'new-key')
    expect(getConfig(USER_A, 'linear_key')).toBe('new-key')
  })

  test('isolates config between users', () => {
    setConfig(USER_A, 'linear_key', 'key-a')
    setConfig(USER_B, 'linear_key', 'key-b')
    expect(getConfig(USER_A, 'linear_key')).toBe('key-a')
    expect(getConfig(USER_B, 'linear_key')).toBe('key-b')
  })
})

describe('getConfig', () => {
  beforeEach(() => {
    store.data.clear()
  })

  test('returns stored value', () => {
    setConfig(USER_A, 'linear_team_id', 'team-abc')
    expect(getConfig(USER_A, 'linear_team_id')).toBe('team-abc')
  })

  test('returns null for unset key', () => {
    expect(getConfig(USER_A, 'openai_model')).toBeNull()
  })
})

describe('getAllConfig', () => {
  beforeEach(() => {
    store.data.clear()
  })

  test('returns all set configs for user', () => {
    setConfig(USER_A, 'linear_key', 'key-1')
    setConfig(USER_A, 'openai_model', 'gpt-4')
    const allConfig = getAllConfig(USER_A)
    expect(allConfig.linear_key).toBe('key-1')
    expect(allConfig.openai_model).toBe('gpt-4')
  })

  test('does not leak config from other users', () => {
    setConfig(USER_A, 'linear_key', 'key-a')
    setConfig(USER_B, 'linear_key', 'key-b')
    const configA = getAllConfig(USER_A)
    expect(configA.linear_key).toBe('key-a')
  })
})

describe('isConfigKey', () => {
  test('returns true for valid keys', () => {
    const validKeys: ConfigKey[] = ['linear_key', 'linear_team_id', 'openai_key', 'openai_base_url', 'openai_model']
    validKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(true)
    })
  })

  test('returns false for invalid keys', () => {
    expect(isConfigKey('invalid')).toBe(false)
  })
})

describe('maskValue', () => {
  test('masks sensitive keys', () => {
    expect(maskValue('linear_key', 'secret-key-1234')).toBe('****1234')
    expect(maskValue('openai_key', 'sk-abc123')).toBe('****c123')
  })

  test('returns unmasked value for non-sensitive keys', () => {
    expect(maskValue('openai_model', 'gpt-4')).toBe('gpt-4')
  })
})

describe('CONFIG_KEYS', () => {
  test('contains all expected keys', () => {
    expect(CONFIG_KEYS).toHaveLength(5)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/config.test.ts`
Expected: FAIL — `setConfig` signature mismatch (expects 2 args, got 3)

**Step 3: Rewrite `src/config.ts`**

```typescript
// src/config.ts
import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'config' })

export type ConfigKey = 'linear_key' | 'linear_team_id' | 'openai_key' | 'openai_base_url' | 'openai_model'

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'linear_key',
  'linear_team_id',
  'openai_key',
  'openai_base_url',
  'openai_model',
]

const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set(['linear_key', 'openai_key'])

const db = getDb()

export function setConfig(userId: number, key: ConfigKey, value: string): void {
  log.debug({ userId, key }, 'setConfig called')
  db.run('INSERT OR REPLACE INTO user_config (user_id, key, value) VALUES (?, ?, ?)', [userId, key, value])
  log.info({ userId, key }, 'Config key set')
}

export function getConfig(userId: number, key: ConfigKey): string | null {
  log.debug({ userId, key }, 'getConfig called')
  const row = db
    .query<{ value: string }, [number, string]>('SELECT value FROM user_config WHERE user_id = ? AND key = ?')
    .get(userId, key)
  return row?.value ?? null
}

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key)
}

export function getAllConfig(userId: number): Partial<Record<ConfigKey, string>> {
  log.debug({ userId }, 'getAllConfig called')
  const rows = db
    .query<{ key: string; value: string }, [number]>('SELECT key, value FROM user_config WHERE user_id = ?')
    .all(userId)
  return rows.reduce<Partial<Record<ConfigKey, string>>>(
    (acc, row) => (isConfigKey(row.key) ? { ...acc, [row.key]: row.value } : acc),
    {},
  )
}

export function maskValue(key: ConfigKey, value: string): string {
  if (SENSITIVE_KEYS.has(key)) {
    const last4 = value.slice(-4)
    return `****${last4}`
  }
  return value
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: make config per-user with user_config table"
```

---

### Task 3: Add schema migration — create users and user_config tables

**Files:**

- Create: `src/db/migrations/003_multiuser_support.ts`

This database migration creates the schema needed for multi-user support:

1. Creates `users` table for authorization
2. Creates `user_config` table for per-user credentials
3. Adds foreign key constraint and index for efficient lookups

**Note:** This is a prerequisite for Task 4 (runtime data migration).

---

### Task 4: Add runtime data migration — seed admin and migrate config

**Files:**

- Create: `src/migrate.ts`
- Create: `tests/migrate.test.ts`

On startup, the runtime migration:

1. Inserts the admin user (from `TELEGRAM_USER_ID`) into `users` (idempotent)
2. If the old `config` table exists and has rows, copies them into `user_config` scoped to the admin using `INSERT OR IGNORE` (won't overwrite existing)

**Step 1: Write the failing tests**

```typescript
// tests/migrate.test.ts
import { mock, describe, expect, test, beforeEach } from 'bun:test'

const store = {
  configRows: new Map<string, string>(),
  userConfigRows: new Map<string, string>(),
  users: new Map<number, boolean>(),
  tableExists: true,
}

const mockResult = mock.module('bun:sqlite', () => ({
  Database: class MockDatabase {
    run(sql: string, params?: (string | number)[]): void {
      if (sql.includes('INSERT INTO users') && params !== undefined) {
        store.users.set(params[0] as number, true)
      }
      if (sql.includes('INSERT OR IGNORE INTO user_config') && params !== undefined) {
        const key = `${params[0]}:${params[1]}`
        if (!store.userConfigRows.has(key)) {
          store.userConfigRows.set(key, params[2] as string)
        }
      }
    }

    query(sql: string): {
      get: () => Record<string, unknown> | null
      all: () => Array<Record<string, unknown>>
    } {
      if (sql.includes('sqlite_master') && sql.includes("name='config'")) {
        return {
          get: (): Record<string, unknown> | null => (store.tableExists ? { name: 'config' } : null),
          all: (): Array<Record<string, unknown>> => [],
        }
      }
      if (sql.includes('SELECT key, value FROM config')) {
        return {
          get: (): null => null,
          all: (): Array<Record<string, unknown>> =>
            Array.from(store.configRows.entries()).map(([key, value]) => ({ key, value })),
        }
      }
      return { get: (): null => null, all: (): Array<Record<string, unknown>> => [] }
    }
  },
}))

if (mockResult instanceof Promise) {
  mockResult.catch(() => {})
}

import { migrateToMultiUser } from '../src/migrate.js'

describe('migrateToMultiUser', () => {
  beforeEach(() => {
    store.configRows.clear()
    store.userConfigRows.clear()
    store.users.clear()
    store.tableExists = true
  })

  test('seeds admin user', () => {
    migrateToMultiUser(12345)
    expect(store.users.has(12345)).toBe(true)
  })

  test('migrates existing config rows to admin user_config', () => {
    store.configRows.set('linear_key', 'lin_xxx')
    store.configRows.set('openai_model', 'gpt-4o')
    migrateToMultiUser(12345)
    expect(store.userConfigRows.get('12345:linear_key')).toBe('lin_xxx')
    expect(store.userConfigRows.get('12345:openai_model')).toBe('gpt-4o')
  })

  test('skips migration when config table does not exist', () => {
    store.tableExists = false
    migrateToMultiUser(12345)
    expect(store.userConfigRows.size).toBe(0)
  })

  test('does not overwrite existing user_config', () => {
    store.userConfigRows.set('12345:linear_key', 'existing')
    store.configRows.set('linear_key', 'old-value')
    migrateToMultiUser(12345)
    expect(store.userConfigRows.get('12345:linear_key')).toBe('existing')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/migrate.test.ts`
Expected: FAIL — module `../src/migrate.js` does not exist

**Step 3: Write the implementation**

```typescript
// src/migrate.ts
import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'migrate' })

/**
 * Runtime migration to seed admin user and migrate legacy config.
 * Must be called after database initialization but before bot starts.
 *
 * This migration is idempotent and safe to run multiple times:
 * - Admin user is inserted with ON CONFLICT DO NOTHING
 * - Config is copied with INSERT OR IGNORE (won't overwrite existing)
 */
export function migrateToMultiUser(adminId: number): void {
  log.debug({ adminId }, 'migrateToMultiUser called')

  const db = getDb()
  log.debug({ adminId }, 'migrateToMultiUser called')

  // Seed admin user
  db.run('INSERT INTO users (telegram_id, added_by) VALUES (?, ?) ON CONFLICT DO NOTHING', [adminId, adminId])
  log.info({ adminId }, 'Admin user seeded')

  // Check if old config table exists
  const tableRow = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='config'")
    .get()

  if (tableRow === null) {
    log.debug('No legacy config table found, skipping migration')
    return
  }

  // Copy rows from config to user_config for the admin user
  const rows = db.query<{ key: string; value: string }, []>('SELECT key, value FROM config').all()
  for (const row of rows) {
    db.run('INSERT OR IGNORE INTO user_config (user_id, key, value) VALUES (?, ?, ?)', [adminId, row.key, row.value])
  }
  log.info({ adminId, migratedKeys: rows.length }, 'Legacy config migrated to user_config')
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/migrate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/migrate.ts tests/migrate.test.ts
git commit -m "feat: add migration to seed admin and copy legacy config"
```

---

### Task 5: Update `bot.ts` — multi-user authorization, admin commands, per-user config

**Files:**

- Modify: `src/bot.ts`
- Modify: `tests/bot.test.ts` (if needed for new imports)

This is the largest task. Changes:

1. Replace `allowedUserId` check with `isAuthorized()` from `users.ts`
2. Keep `TELEGRAM_USER_ID` as `adminUserId` for admin-only commands
3. `/set` and `/config` pass `userId` to config functions
4. `callLlm` reads config per-user
5. New admin commands: `/user add <id|@username>`, `/user remove <id|@username>`, `/users`

**Step 1: Update `bot.ts`**

Key changes (not a full rewrite — only the diffs):

1. **Imports** — add `isAuthorized`, `isAuthorizedByUsername`, `addUser`, `removeUser`, `listUsers` from `./users.js`

2. **Replace `checkAuthorization`:**

```typescript
const adminUserId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)

const checkAuthorization = (userId: number | undefined): userId is number => {
  log.debug({ userId }, 'Checking authorization')
  if (userId === undefined || !isAuthorized(userId)) {
    if (userId !== undefined) {
      log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
    }
    return false
  }
  return true
}

const checkAdmin = (userId: number | undefined): userId is number => {
  if (userId === undefined || userId !== adminUserId) {
    return false
  }
  return true
}
```

3. **Update `/set` command** — pass `userId` to `setConfig`:

```typescript
bot.command('set', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId)) {
    return
  }
  // ... parse key/value (same as current) ...
  setConfig(userId, key, value)
  log.info({ userId, key }, '/set command executed')
  await ctx.reply(`Set ${key} successfully.`)
})
```

4. **Update `/config` command** — pass `userId` to `getAllConfig`:

```typescript
bot.command('config', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId)) {
    return
  }
  const config = getAllConfig(userId)
  // ... same formatting logic ...
})
```

5. **Update `callLlm`** — read per-user config:

```typescript
const callLlm = async (ctx: Context, userId: number, history: readonly ModelMessage[]): Promise<void> => {
  const requiredKeys = ['openai_key', 'openai_base_url', 'openai_model', 'linear_key', 'linear_team_id'] as const
  const missing = requiredKeys.filter((k) => getConfig(userId, k) === null)
  // ...
  const openaiKey = getConfig(userId, 'openai_key')!
  const openaiBaseUrl = getConfig(userId, 'openai_base_url')!
  const openaiModel = getConfig(userId, 'openai_model')!
  const linearKey = getConfig(userId, 'linear_key')!
  const linearTeamId = getConfig(userId, 'linear_team_id')!
  // ... rest unchanged ...
}
```

6. **Add admin commands:**

```typescript
// Helper to parse user identifier (ID or username)
const parseUserIdentifier = (
  input: string,
): { type: 'id'; value: number } | { type: 'username'; value: string } | null => {
  const trimmed = input.trim()
  // Check if it's a username (starts with @ or contains only letters/numbers/underscores)
  if (trimmed.startsWith('@')) {
    return { type: 'username', value: trimmed.slice(1) }
  }
  // Try parsing as numeric ID
  const num = parseInt(trimmed, 10)
  if (!Number.isNaN(num)) {
    return { type: 'id', value: num }
  }
  // Treat as username if it looks like one
  if (/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { type: 'username', value: trimmed }
  }
  return null
}

bot.command('user', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAdmin(userId)) {
    await ctx.reply('Only the admin can manage users.')
    return
  }

  const args = ctx.match.trim().split(/\s+/)
  const subcommand = args[0]
  const identifier = args[1]

  if (subcommand === 'add') {
    if (!identifier) {
      await ctx.reply('Usage: /user add <telegram_user_id|@username>')
      return
    }

    const parsed = parseUserIdentifier(identifier)
    if (parsed === null) {
      await ctx.reply('Invalid identifier. Use numeric ID or @username')
      return
    }

    if (parsed.type === 'id') {
      addUser(parsed.value, userId)
      log.info({ adminId: userId, newUserId: parsed.value }, '/user add command executed')
      await ctx.reply(`User ${parsed.value} authorized.`)
    } else {
      addUser(0, userId, parsed.value) // ID 0 placeholder, username will be resolved on first login
      log.info({ adminId: userId, username: parsed.value }, '/user add command executed')
      await ctx.reply(`User @${parsed.value} authorized.`)
    }
  } else if (subcommand === 'remove') {
    if (!identifier) {
      await ctx.reply('Usage: /user remove <telegram_user_id|@username>')
      return
    }

    const parsed = parseUserIdentifier(identifier)
    if (parsed === null) {
      await ctx.reply('Invalid identifier. Use numeric ID or @username')
      return
    }

    if (parsed.type === 'id' && parsed.value === adminUserId) {
      await ctx.reply('Cannot remove the admin user.')
      return
    }

    removeUser(parsed.value)
    log.info({ adminId: userId, identifier: parsed.value }, '/user remove command executed')
    await ctx.reply(`User ${identifier} removed.`)
  } else {
    await ctx.reply('Usage: /user add <id|@username> or /user remove <id|@username>')
  }
})

bot.command('users', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAdmin(userId)) {
    await ctx.reply('Only the admin can list users.')
    return
  }

  const users = listUsers()
  if (users.length === 0) {
    await ctx.reply('No authorized users.')
    return
  }

  const lines = users.map((u) => {
    const admin = u.telegram_id === adminUserId ? ' (admin)' : ''
    const username = u.username ? ` (@${u.username})` : ''
    return `${u.telegram_id}${username}${admin} — added ${u.added_at}`
  })
  log.info({ userId }, '/users command executed')
  await ctx.reply(lines.join('\n'))
})
```

**Step 2: Run all tests**

Run: `bun test`
Expected: PASS — the bot.test.ts is minimal and should still pass. Config tests were already updated.

**Step 3: Commit**

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "feat: multi-user authorization with admin commands"
```

---

### Task 6: Wire migration into `index.ts`

**Files:**

- Modify: `src/index.ts`

**Step 1: Update `index.ts`**

Add the migration call after env var validation, before starting the bot:

```typescript
import { bot } from './bot.js'
import { logger } from './logger.js'
import { migrateToMultiUser } from './migrate.js'

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_USER_ID']

const missing = REQUIRED_ENV_VARS.filter((v) => (process.env[v]?.trim() ?? '') === '')
if (missing.length > 0) {
  log.error({ variables: missing }, 'Missing required environment variables')
  process.exit(1)
}

const adminId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)
migrateToMultiUser(adminId)
log.info({ adminId }, 'Migration complete')

log.info('Starting papai...')

void bot.start({
  onStart: () => {
    log.info('papai is running and listening for messages.')
  },
})
```

**Step 2: Run lint and type-check**

Run: `bun run lint && bunx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire multi-user migration into startup"
```

---

### Task 7: Update documentation

**Files:**

- Modify: `CLAUDE.md` (Architecture, Required Environment Variables, Available tools table — add admin commands)
- Modify: `README.md` (if it documents single-user setup)
- Modify: `.env.example` (add comment explaining admin role)
- Modify: `ROADMAP.md` (check off multi-user item)

**Step 1: Update CLAUDE.md**

Key documentation changes:

- `TELEGRAM_USER_ID` description: "The admin user ID. This user is automatically authorized on first run and can manage other users."
- Add new commands to architecture section: `/user add <id|@username>`, `/user remove <id|@username>`, `/users`
- Update `src/config.ts` description: "SQLite-backed **per-user** runtime config store"
- Add `src/users.ts` — "SQLite-backed user authorization store"
- Add `src/migrate.ts` — "One-time migration: seeds admin, copies legacy config"

**Step 2: Update ROADMAP.md**

Change:

```
- [ ] Multi-user support with per-user authorization
```

To:

```
- [x] Multi-user support with per-user authorization
```

**Step 3: Commit**

```bash
git add CLAUDE.md README.md .env.example ROADMAP.md
git commit -m "docs: update documentation for multi-user support"
```

---

### Task 8: Run full test suite and lint

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 2: Run lint**

Run: `bun run lint`
Expected: No errors

**Step 3: Run type-check**

Run: `bunx tsc --noEmit`
Expected: No errors

**Step 4: Run format check**

Run: `bun run format:check`
Expected: No formatting issues (run `bun run format` if needed)

---

## Summary of new/modified files

| File                                         | Action                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| `src/db/migrations/003_multiuser_support.ts` | Create — schema migration for users and user_config tables      |
| `src/users.ts`                               | Create — user authorization store                               |
| `tests/users.test.ts`                        | Create — tests for users module                                 |
| `src/migrate.ts`                             | Create — runtime data migration (seed admin, copy config)       |
| `tests/migrate.test.ts`                      | Create — tests for migration                                    |
| `src/config.ts`                              | Modify — per-user config (`userId` parameter)                   |
| `tests/config.test.ts`                       | Modify — updated for per-user signatures                        |
| `src/bot.ts`                                 | Modify — multi-user auth, admin commands, per-user config reads |
| `tests/bot.test.ts`                          | Modify — if needed for new imports                              |
| `src/index.ts`                               | Modify — wire migration                                         |
| `CLAUDE.md`                                  | Modify — document new architecture                              |
| `README.md`                                  | Modify — document multi-user setup                              |
| `.env.example`                               | Modify — clarify admin role                                     |
| `ROADMAP.md`                                 | Modify — check off item                                         |
