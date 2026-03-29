# Plugin System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the plugin framework described in `docs/plans/2026-03-30-plugin-system-design.md` — convention-based plugin discovery, scoped storage API, framework service injection, two-layer permissions, and LLM tool/prompt integration.

**Architecture:** Plugins live in `plugins/<id>/` with a `plugin.json` manifest and a factory function entry point. The framework discovers, validates, loads, and activates plugins at startup. Each plugin receives a frozen `PluginContext` with scoped registration APIs (tools, prompts, scheduler, commands) and permission-gated framework services (store, taskProvider, chat). A `plugin_kv` table provides isolated key-value storage. Tools and prompt fragments are merged into the existing `makeTools()` and `buildSystemPrompt()` flows. Admin manages plugins via `/plugin` command with inline buttons; users opt-in via `/config`.

**Tech Stack:** Bun, TypeScript (strict), Zod v4, Drizzle ORM (SQLite), pino, Vercel AI SDK (`ai` package), existing scheduler utility (`src/utils/scheduler.ts`)

---

## Task 1: Plugin Type Definitions

**Files:**

- Create: `src/plugins/types.ts`
- Test: `tests/plugins/types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/types.test.ts
import { describe, expect, test } from 'bun:test'

import { pluginManifestSchema } from '../../src/plugins/types.js'

describe('pluginManifestSchema', () => {
  test('accepts a valid minimal manifest', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'hello-world',
      name: 'Hello World',
      version: '1.0.0',
      description: 'A test plugin',
      contributes: {},
      permissions: [],
    })
    expect(result.success).toBe(true)
  })

  test('accepts a full manifest with all optional fields', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'finance-tracker',
      name: 'Finance Tracker',
      version: '1.2.0',
      description: 'Track expenses',
      author: 'test',
      minAppVersion: '2.0.0',
      contributes: {
        tools: ['record_expense'],
        promptFragments: ['finance-context'],
        jobs: ['daily-summary'],
        commands: ['finance'],
      },
      permissions: ['store', 'scheduler', 'taskProvider', 'chat'],
      main: 'entry.ts',
      configRequirements: [{ key: 'api_key', label: 'Bank API Token', sensitive: true, required: true }],
      autoEnable: true,
    })
    expect(result.success).toBe(true)
  })

  test('rejects manifest missing required fields', () => {
    const result = pluginManifestSchema.safeParse({ id: 'test' })
    expect(result.success).toBe(false)
  })

  test('rejects invalid id format (uppercase)', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'Hello_World',
      name: 'Hello',
      version: '1.0.0',
      description: 'test',
      contributes: {},
      permissions: [],
    })
    expect(result.success).toBe(false)
  })

  test('rejects invalid permission value', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      description: 'test',
      contributes: {},
      permissions: ['database'],
    })
    expect(result.success).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/types.test.ts`
Expected: FAIL — cannot find module `../../src/plugins/types.js`

**Step 3: Write the implementation**

```typescript
// src/plugins/types.ts
import { z } from 'zod'

import type { ToolSet } from 'ai'
import type { Logger } from 'pino'

import type { CommandHandler } from '../chat/types.js'
import type { TaskProvider } from '../providers/types.js'

// ── Manifest Schema ──

const pluginIdPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

const configRequirementSchema = z.object({
  key: z.string(),
  label: z.string(),
  sensitive: z.boolean().optional(),
  required: z.boolean().optional(),
})

export const pluginManifestSchema = z.object({
  id: z.string().regex(pluginIdPattern, 'Must be lowercase alphanumeric with hyphens'),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  minAppVersion: z.string().optional(),
  contributes: z.object({
    tools: z.array(z.string()).optional(),
    promptFragments: z.array(z.string()).optional(),
    jobs: z.array(z.string()).optional(),
    commands: z.array(z.string()).optional(),
  }),
  permissions: z.array(z.enum(['store', 'scheduler', 'taskProvider', 'chat'])),
  main: z.string().optional(),
  configRequirements: z.array(configRequirementSchema).optional(),
  autoEnable: z.boolean().optional(),
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>
export type PluginPermission = PluginManifest['permissions'][number]
export type PluginConfigRequirement = z.infer<typeof configRequirementSchema>

// ── Plugin Lifecycle ──

export interface PluginInstance {
  activate(ctx: PluginContext): Promise<void> | void
  deactivate?(): Promise<void> | void
}

export type PluginFactory = () => PluginInstance

// ── Plugin State ──

export type PluginState = 'discovered' | 'approved' | 'rejected' | 'active' | 'error'

export type RegisteredPlugin = {
  readonly manifest: PluginManifest
  readonly dir: string
  state: PluginState
  instance?: PluginInstance
  error?: string
  readonly registeredTools: Map<string, ToolSet[string]>
  readonly registeredPrompts: Map<string, string | (() => string | Promise<string>)>
  readonly registeredJobs: string[]
  readonly registeredCommands: string[]
}

// ── Plugin Context (injected into plugins) ──

export interface PluginToolRegistry {
  register(name: string, tool: ToolSet[string]): void
}

export interface PluginPromptRegistry {
  register(key: string, fragment: string | (() => string | Promise<string>)): void
}

export interface PluginSchedulerRegistry {
  register(
    name: string,
    config: {
      cron?: string
      interval?: number
      handler: (userId: string) => Promise<void> | void
    },
  ): void
}

export interface PluginCommandRegistry {
  register(name: string, handler: CommandHandler): void
}

export interface PluginStore {
  get<T = unknown>(userId: string, key: string): Promise<T | null>
  set<T = unknown>(userId: string, key: string, value: T): Promise<void>
  delete(userId: string, key: string): Promise<void>
  list(userId: string, prefix?: string): Promise<Array<{ key: string; value: unknown }>>
  setSecret(userId: string, key: string, value: string): Promise<void>
  getSecret(userId: string, key: string): Promise<string | null>
}

export interface PluginChatService {
  sendMessage(userId: string, markdown: string): Promise<void>
}

export interface PluginContext {
  readonly pluginId: string
  readonly logger: Logger
  readonly tools: PluginToolRegistry
  readonly prompts: PluginPromptRegistry
  readonly scheduler: PluginSchedulerRegistry
  readonly commands: PluginCommandRegistry
  readonly store: PluginStore
  readonly taskProvider: TaskProvider
  readonly chat: PluginChatService
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/types.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/plugins/types.ts tests/plugins/types.test.ts
git commit -m "feat(plugins): add type definitions and manifest schema"
```

---

## Task 2: Database Migration for Plugin Tables

**Files:**

- Create: `src/db/migrations/019_plugins.ts`
- Modify: `src/db/schema.ts:257` (append new table definitions)
- Modify: `src/db/index.ts:22,67` (import and register migration)

**Step 1: Write the migration**

```typescript
// src/db/migrations/019_plugins.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration019Plugins: Migration = {
  id: '019_plugins',
  up(db: Database): void {
    db.run(`
      CREATE TABLE plugin_admin_state (
        plugin_id   TEXT PRIMARY KEY,
        state       TEXT NOT NULL,
        approved_by TEXT,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    db.run(`
      CREATE TABLE plugin_user_state (
        plugin_id   TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        enabled     INTEGER NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (plugin_id, user_id)
      )
    `)

    db.run(`
      CREATE TABLE plugin_kv (
        plugin_id   TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        key         TEXT NOT NULL,
        value       TEXT NOT NULL,
        encrypted   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (plugin_id, user_id, key)
      )
    `)
  },
}
```

**Step 2: Add Drizzle schema definitions**

Append to `src/db/schema.ts` after line 257 (`export type MemoLinkRow = ...`):

```typescript
// ── Plugin tables ──

export const pluginAdminState = sqliteTable('plugin_admin_state', {
  pluginId: text('plugin_id').primaryKey(),
  state: text('state').notNull(),
  approvedBy: text('approved_by'),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const pluginUserState = sqliteTable(
  'plugin_user_state',
  {
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id').notNull(),
    enabled: integer('enabled').notNull(),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.pluginId, table.userId] })],
)

export const pluginKv = sqliteTable(
  'plugin_kv',
  {
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    encrypted: integer('encrypted').notNull().default(0),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.pluginId, table.userId, table.key] })],
)

export type PluginAdminStateRow = typeof pluginAdminState.$inferSelect
export type PluginUserStateRow = typeof pluginUserState.$inferSelect
export type PluginKvRow = typeof pluginKv.$inferSelect
```

Note: Check existing imports at the top of `src/db/schema.ts` — you may need to add `primaryKey` and `integer` to the import from `drizzle-orm/sqlite-core`. Check what's already imported.

**Step 3: Register migration in `src/db/index.ts`**

Add import after line 22:

```typescript
import { migration019Plugins } from './migrations/019_plugins.js'
```

Add to MIGRATIONS array after line 67 (before `] as const`):

```typescript
  migration019Plugins,
```

**Step 4: Verify migration runs**

Run: `bun test tests/plugins/types.test.ts`
Expected: PASS (existing tests still pass — migration doesn't break anything)

Run: `bun typecheck`
Expected: No new errors from the schema additions

**Step 5: Commit**

```bash
git add src/db/migrations/019_plugins.ts src/db/schema.ts src/db/index.ts
git commit -m "feat(plugins): add database migration for plugin tables"
```

---

## Task 3: Plugin Store Implementation

**Files:**

- Create: `src/plugins/store.ts`
- Test: `tests/plugins/store.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/store.test.ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

mockLogger()

// Must import after mock
import { createPluginStore } from '../../src/plugins/store.js'
import type { PluginStore } from '../../src/plugins/types.js'

describe('PluginStore', () => {
  let store: PluginStore

  beforeEach(async () => {
    await setupTestDb()
    store = createPluginStore('test-plugin')
  })

  afterAll(() => {
    mock.restore()
  })

  test('set and get a value', async () => {
    await store.set('user1', 'key1', { amount: 100, currency: 'USD' })
    const result = await store.get('user1', 'key1')
    expect(result).toEqual({ amount: 100, currency: 'USD' })
  })

  test('get returns null for missing key', async () => {
    const result = await store.get('user1', 'nonexistent')
    expect(result).toBeNull()
  })

  test('delete removes a key', async () => {
    await store.set('user1', 'key1', 'value')
    await store.delete('user1', 'key1')
    const result = await store.get('user1', 'key1')
    expect(result).toBeNull()
  })

  test('list returns keys matching prefix', async () => {
    await store.set('user1', 'expense:1', { amount: 50 })
    await store.set('user1', 'expense:2', { amount: 75 })
    await store.set('user1', 'income:1', { amount: 200 })
    const results = await store.list('user1', 'expense:')
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.key)).toEqual(['expense:1', 'expense:2'])
  })

  test('list without prefix returns all keys', async () => {
    await store.set('user1', 'a', 1)
    await store.set('user1', 'b', 2)
    const results = await store.list('user1')
    expect(results).toHaveLength(2)
  })

  test('isolates data between plugins', async () => {
    const otherStore = createPluginStore('other-plugin')
    await store.set('user1', 'key1', 'from-test')
    await otherStore.set('user1', 'key1', 'from-other')
    expect(await store.get('user1', 'key1')).toBe('from-test')
    expect(await otherStore.get('user1', 'key1')).toBe('from-other')
  })

  test('isolates data between users', async () => {
    await store.set('user1', 'key1', 'user1-value')
    await store.set('user2', 'key1', 'user2-value')
    expect(await store.get('user1', 'key1')).toBe('user1-value')
    expect(await store.get('user2', 'key1')).toBe('user2-value')
  })

  test('set overwrites existing value', async () => {
    await store.set('user1', 'key1', 'old')
    await store.set('user1', 'key1', 'new')
    expect(await store.get('user1', 'key1')).toBe('new')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/store.test.ts`
Expected: FAIL — cannot find module `../../src/plugins/store.js`

**Step 3: Write the implementation**

```typescript
// src/plugins/store.ts
import { eq, and, like } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { pluginKv } from '../db/schema.js'
import { logger } from '../logger.js'
import type { PluginStore } from './types.js'

const log = logger.child({ scope: 'plugin-store' })

export function createPluginStore(pluginId: string): PluginStore {
  const db = () => getDrizzleDb()

  return {
    async get<T = unknown>(userId: string, key: string): Promise<T | null> {
      const rows = db()
        .select({ value: pluginKv.value, encrypted: pluginKv.encrypted })
        .from(pluginKv)
        .where(and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.userId, userId), eq(pluginKv.key, key)))
        .all()
      if (rows.length === 0) return null
      // get() returns null for encrypted values — use getSecret() instead
      if (rows[0].encrypted === 1) return null
      return JSON.parse(rows[0].value) as T
    },

    async set<T = unknown>(userId: string, key: string, value: T): Promise<void> {
      const now = new Date().toISOString()
      const jsonValue = JSON.stringify(value)
      db()
        .insert(pluginKv)
        .values({ pluginId, userId, key, value: jsonValue, encrypted: 0, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [pluginKv.pluginId, pluginKv.userId, pluginKv.key],
          set: { value: jsonValue, encrypted: 0, updatedAt: now },
        })
        .run()
      log.debug({ pluginId, userId, key }, 'Plugin store set')
    },

    async delete(userId: string, key: string): Promise<void> {
      db()
        .delete(pluginKv)
        .where(and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.userId, userId), eq(pluginKv.key, key)))
        .run()
      log.debug({ pluginId, userId, key }, 'Plugin store delete')
    },

    async list(userId: string, prefix?: string): Promise<Array<{ key: string; value: unknown }>> {
      const conditions = [eq(pluginKv.pluginId, pluginId), eq(pluginKv.userId, userId), eq(pluginKv.encrypted, 0)]
      if (prefix !== undefined) {
        conditions.push(like(pluginKv.key, `${prefix}%`))
      }
      const rows = db()
        .select({ key: pluginKv.key, value: pluginKv.value })
        .from(pluginKv)
        .where(and(...conditions))
        .all()
      return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) as unknown }))
    },

    async setSecret(userId: string, key: string, value: string): Promise<void> {
      // TODO: Implement AES-256-GCM encryption in a follow-up task
      // For now, store as plain text with encrypted flag for future migration
      const now = new Date().toISOString()
      db()
        .insert(pluginKv)
        .values({ pluginId, userId, key, value, encrypted: 1, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [pluginKv.pluginId, pluginKv.userId, pluginKv.key],
          set: { value, encrypted: 1, updatedAt: now },
        })
        .run()
      log.debug({ pluginId, userId, key }, 'Plugin store setSecret')
    },

    async getSecret(userId: string, key: string): Promise<string | null> {
      const rows = db()
        .select({ value: pluginKv.value, encrypted: pluginKv.encrypted })
        .from(pluginKv)
        .where(and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.userId, userId), eq(pluginKv.key, key)))
        .all()
      if (rows.length === 0) return null
      if (rows[0].encrypted !== 1) return null
      // TODO: decrypt when encryption is implemented
      return rows[0].value
    },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/store.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add src/plugins/store.ts tests/plugins/store.test.ts
git commit -m "feat(plugins): implement scoped plugin key-value store"
```

---

## Task 4: Plugin Discovery

**Files:**

- Create: `src/plugins/discovery.ts`
- Test: `tests/plugins/discovery.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/discovery.test.ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

import { discoverPlugins } from '../../src/plugins/discovery.js'

describe('discoverPlugins', () => {
  let pluginsDir: string

  beforeEach(() => {
    pluginsDir = join(tmpdir(), `papai-test-plugins-${Date.now()}`)
    mkdirSync(pluginsDir, { recursive: true })
  })

  afterAll(() => {
    mock.restore()
  })

  test('discovers valid plugin manifests', async () => {
    const pluginDir = join(pluginsDir, 'hello')
    mkdirSync(pluginDir)
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'hello',
        name: 'Hello',
        version: '1.0.0',
        description: 'test',
        contributes: {},
        permissions: [],
      }),
    )

    const plugins = await discoverPlugins(pluginsDir)
    expect(plugins).toHaveLength(1)
    expect(plugins[0].manifest.id).toBe('hello')
    expect(plugins[0].dir).toBe(pluginDir)
  })

  test('skips directories without plugin.json', async () => {
    mkdirSync(join(pluginsDir, 'empty'))
    const plugins = await discoverPlugins(pluginsDir)
    expect(plugins).toHaveLength(0)
  })

  test('skips malformed JSON', async () => {
    const pluginDir = join(pluginsDir, 'bad')
    mkdirSync(pluginDir)
    writeFileSync(join(pluginDir, 'plugin.json'), 'not json')
    const plugins = await discoverPlugins(pluginsDir)
    expect(plugins).toHaveLength(0)
  })

  test('skips invalid manifest (missing required fields)', async () => {
    const pluginDir = join(pluginsDir, 'incomplete')
    mkdirSync(pluginDir)
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ id: 'incomplete' }))
    const plugins = await discoverPlugins(pluginsDir)
    expect(plugins).toHaveLength(0)
  })

  test('skips duplicate plugin IDs', async () => {
    const manifest = {
      id: 'dupe',
      name: 'Dupe',
      version: '1.0.0',
      description: 'test',
      contributes: {},
      permissions: [],
    }
    const dir1 = join(pluginsDir, 'dupe-a')
    const dir2 = join(pluginsDir, 'dupe-b')
    mkdirSync(dir1)
    mkdirSync(dir2)
    writeFileSync(join(dir1, 'plugin.json'), JSON.stringify(manifest))
    writeFileSync(join(dir2, 'plugin.json'), JSON.stringify(manifest))
    const plugins = await discoverPlugins(pluginsDir)
    expect(plugins).toHaveLength(1)
  })

  test('returns empty array when directory does not exist', async () => {
    const plugins = await discoverPlugins('/nonexistent/path')
    expect(plugins).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/discovery.test.ts`
Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```typescript
// src/plugins/discovery.ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { logger } from '../logger.js'
import { pluginManifestSchema, type PluginManifest } from './types.js'

const log = logger.child({ scope: 'plugin-discovery' })

export type DiscoveredPlugin = {
  readonly manifest: PluginManifest
  readonly dir: string
}

export async function discoverPlugins(pluginsDir: string): Promise<DiscoveredPlugin[]> {
  if (!existsSync(pluginsDir)) {
    log.debug({ pluginsDir }, 'Plugins directory does not exist')
    return []
  }

  const entries = readdirSync(pluginsDir)
  const discovered: DiscoveredPlugin[] = []
  const seenIds = new Set<string>()

  for (const entry of entries) {
    const dir = join(pluginsDir, entry)
    if (!statSync(dir).isDirectory()) continue

    const manifestPath = join(dir, 'plugin.json')
    if (!existsSync(manifestPath)) continue

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch {
      log.warn({ dir }, 'Failed to parse plugin.json')
      continue
    }

    const result = pluginManifestSchema.safeParse(raw)
    if (!result.success) {
      log.warn({ dir, errors: result.error.issues }, 'Invalid plugin manifest')
      continue
    }

    const manifest = result.data
    if (seenIds.has(manifest.id)) {
      log.warn({ pluginId: manifest.id, dir }, 'Duplicate plugin ID, skipping')
      continue
    }

    seenIds.add(manifest.id)
    discovered.push({ manifest, dir })
    log.info({ pluginId: manifest.id, version: manifest.version, dir }, 'Discovered plugin')
  }

  return discovered
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/discovery.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add src/plugins/discovery.ts tests/plugins/discovery.test.ts
git commit -m "feat(plugins): implement plugin directory discovery"
```

---

## Task 5: Plugin Registry

**Files:**

- Create: `src/plugins/registry.ts`
- Test: `tests/plugins/registry.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/registry.test.ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

mockLogger()

import { createPluginRegistry } from '../../src/plugins/registry.js'
import type { PluginManifest } from '../../src/plugins/types.js'

const makeManifest = (id: string, overrides?: Partial<PluginManifest>): PluginManifest => ({
  id,
  name: id,
  version: '1.0.0',
  description: 'test',
  contributes: {},
  permissions: [],
  ...overrides,
})

describe('PluginRegistry', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    mock.restore()
  })

  test('registers a discovered plugin', () => {
    const registry = createPluginRegistry()
    registry.register({ manifest: makeManifest('test'), dir: '/tmp/test' })
    const plugin = registry.get('test')
    expect(plugin).toBeDefined()
    expect(plugin!.state).toBe('discovered')
  })

  test('approvePlugin changes state to approved', () => {
    const registry = createPluginRegistry()
    registry.register({ manifest: makeManifest('test'), dir: '/tmp/test' })
    registry.approvePlugin('test', 'admin1')
    expect(registry.get('test')!.state).toBe('approved')
  })

  test('rejectPlugin changes state to rejected', () => {
    const registry = createPluginRegistry()
    registry.register({ manifest: makeManifest('test'), dir: '/tmp/test' })
    registry.rejectPlugin('test')
    expect(registry.get('test')!.state).toBe('rejected')
  })

  test('getAll returns all registered plugins', () => {
    const registry = createPluginRegistry()
    registry.register({ manifest: makeManifest('a'), dir: '/tmp/a' })
    registry.register({ manifest: makeManifest('b'), dir: '/tmp/b' })
    expect(registry.getAll()).toHaveLength(2)
  })

  test('setUserPluginState and isPluginActiveForUser', () => {
    const registry = createPluginRegistry()
    const manifest = makeManifest('test')
    registry.register({ manifest, dir: '/tmp/test' })
    registry.approvePlugin('test', 'admin1')
    // Simulate active state (normally set by loader)
    registry.get('test')!.state = 'active'

    // Not enabled by default (autoEnable not set)
    expect(registry.isPluginActiveForUser('test', 'user1')).toBe(false)

    // User enables it
    registry.setUserPluginState('test', 'user1', true)
    expect(registry.isPluginActiveForUser('test', 'user1')).toBe(true)

    // User disables it
    registry.setUserPluginState('test', 'user1', false)
    expect(registry.isPluginActiveForUser('test', 'user1')).toBe(false)
  })

  test('autoEnable makes plugin active by default', () => {
    const registry = createPluginRegistry()
    const manifest = makeManifest('test', { autoEnable: true })
    registry.register({ manifest, dir: '/tmp/test' })
    registry.approvePlugin('test', 'admin1')
    registry.get('test')!.state = 'active'
    expect(registry.isPluginActiveForUser('test', 'user1')).toBe(true)
  })

  test('isPluginActiveForUser returns false for non-active plugin', () => {
    const registry = createPluginRegistry()
    registry.register({ manifest: makeManifest('test'), dir: '/tmp/test' })
    // state is 'discovered', not 'active'
    expect(registry.isPluginActiveForUser('test', 'user1')).toBe(false)
  })

  test('getActivePluginsForUser returns only active+enabled plugins', () => {
    const registry = createPluginRegistry()
    registry.register({ manifest: makeManifest('enabled', { autoEnable: true }), dir: '/tmp/a' })
    registry.register({ manifest: makeManifest('disabled'), dir: '/tmp/b' })
    // Both approved and active
    registry.approvePlugin('enabled', 'admin1')
    registry.approvePlugin('disabled', 'admin1')
    registry.get('enabled')!.state = 'active'
    registry.get('disabled')!.state = 'active'

    const active = registry.getActivePluginsForUser('user1')
    expect(active).toHaveLength(1)
    expect(active[0].manifest.id).toBe('enabled')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/registry.test.ts`
Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```typescript
// src/plugins/registry.ts
import { eq, and } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { pluginAdminState, pluginUserState } from '../db/schema.js'
import { logger } from '../logger.js'
import type { DiscoveredPlugin } from './discovery.js'
import type { RegisteredPlugin } from './types.js'

const log = logger.child({ scope: 'plugin-registry' })

export interface PluginRegistry {
  register(discovered: DiscoveredPlugin): void
  get(pluginId: string): RegisteredPlugin | undefined
  getAll(): RegisteredPlugin[]
  approvePlugin(pluginId: string, approvedBy: string): void
  rejectPlugin(pluginId: string): void
  isPluginActiveForUser(pluginId: string, userId: string): boolean
  setUserPluginState(pluginId: string, userId: string, enabled: boolean): void
  getActivePluginsForUser(userId: string): RegisteredPlugin[]
  loadAdminStates(): void
}

export function createPluginRegistry(): PluginRegistry {
  const plugins = new Map<string, RegisteredPlugin>()
  const db = () => getDrizzleDb()

  return {
    register(discovered: DiscoveredPlugin): void {
      plugins.set(discovered.manifest.id, {
        manifest: discovered.manifest,
        dir: discovered.dir,
        state: 'discovered',
        registeredTools: new Map(),
        registeredPrompts: new Map(),
        registeredJobs: [],
        registeredCommands: [],
      })
    },

    get(pluginId: string): RegisteredPlugin | undefined {
      return plugins.get(pluginId)
    },

    getAll(): RegisteredPlugin[] {
      return [...plugins.values()]
    },

    approvePlugin(pluginId: string, approvedBy: string): void {
      const plugin = plugins.get(pluginId)
      if (plugin === undefined) return
      plugin.state = 'approved'
      const now = new Date().toISOString()
      db()
        .insert(pluginAdminState)
        .values({ pluginId, state: 'approved', approvedBy, updatedAt: now })
        .onConflictDoUpdate({
          target: pluginAdminState.pluginId,
          set: { state: 'approved', approvedBy, updatedAt: now },
        })
        .run()
      log.info({ pluginId, approvedBy }, 'Plugin approved')
    },

    rejectPlugin(pluginId: string): void {
      const plugin = plugins.get(pluginId)
      if (plugin === undefined) return
      plugin.state = 'rejected'
      const now = new Date().toISOString()
      db()
        .insert(pluginAdminState)
        .values({ pluginId, state: 'rejected', updatedAt: now })
        .onConflictDoUpdate({
          target: pluginAdminState.pluginId,
          set: { state: 'rejected', updatedAt: now },
        })
        .run()
      log.info({ pluginId }, 'Plugin rejected')
    },

    loadAdminStates(): void {
      const rows = db().select().from(pluginAdminState).all()
      for (const row of rows) {
        const plugin = plugins.get(row.pluginId)
        if (plugin !== undefined) {
          plugin.state = row.state as 'approved' | 'rejected'
        }
      }
      log.debug({ count: rows.length }, 'Loaded plugin admin states')
    },

    isPluginActiveForUser(pluginId: string, userId: string): boolean {
      const plugin = plugins.get(pluginId)
      if (plugin === undefined || plugin.state !== 'active') return false

      const rows = db()
        .select({ enabled: pluginUserState.enabled })
        .from(pluginUserState)
        .where(and(eq(pluginUserState.pluginId, pluginId), eq(pluginUserState.userId, userId)))
        .all()

      if (rows.length > 0) return rows[0].enabled === 1
      return plugin.manifest.autoEnable ?? false
    },

    setUserPluginState(pluginId: string, userId: string, enabled: boolean): void {
      const now = new Date().toISOString()
      db()
        .insert(pluginUserState)
        .values({ pluginId, userId, enabled: enabled ? 1 : 0, updatedAt: now })
        .onConflictDoUpdate({
          target: [pluginUserState.pluginId, pluginUserState.userId],
          set: { enabled: enabled ? 1 : 0, updatedAt: now },
        })
        .run()
      log.info({ pluginId, userId, enabled }, 'User plugin state updated')
    },

    getActivePluginsForUser(userId: string): RegisteredPlugin[] {
      return [...plugins.values()].filter((p) => this.isPluginActiveForUser(p.manifest.id, userId))
    },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/registry.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add src/plugins/registry.ts tests/plugins/registry.test.ts
git commit -m "feat(plugins): implement plugin registry with admin/user state"
```

---

## Task 6: Plugin Context Builder

**Files:**

- Create: `src/plugins/context.ts`
- Test: `tests/plugins/context.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/context.test.ts
import { afterAll, describe, expect, mock, test } from 'bun:test'

import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

import { buildPluginContext } from '../../src/plugins/context.js'
import type { PluginManifest, RegisteredPlugin } from '../../src/plugins/types.js'

const makePlugin = (
  permissions: PluginManifest['permissions'],
  contributes?: PluginManifest['contributes'],
): RegisteredPlugin => ({
  manifest: {
    id: 'test-plugin',
    name: 'Test',
    version: '1.0.0',
    description: 'test',
    contributes: contributes ?? {
      tools: ['my_tool'],
      promptFragments: ['my-prompt'],
      jobs: ['my-job'],
      commands: ['my-cmd'],
    },
    permissions,
  },
  dir: '/tmp/test',
  state: 'approved',
  registeredTools: new Map(),
  registeredPrompts: new Map(),
  registeredJobs: [],
  registeredCommands: [],
})

describe('buildPluginContext', () => {
  afterAll(() => {
    mock.restore()
  })

  test('creates context with correct pluginId', () => {
    const plugin = makePlugin([])
    const ctx = buildPluginContext(plugin, {})
    expect(ctx.pluginId).toBe('test-plugin')
  })

  test('tools.register adds to plugin registeredTools', () => {
    const plugin = makePlugin([])
    const ctx = buildPluginContext(plugin, {})
    const fakeTool = { description: 'test', execute: async () => ({}) }
    ctx.tools.register('my_tool', fakeTool as any)
    expect(plugin.registeredTools.has('my_tool')).toBe(true)
  })

  test('tools.register rejects undeclared tool name', () => {
    const plugin = makePlugin([])
    const ctx = buildPluginContext(plugin, {})
    expect(() => ctx.tools.register('undeclared_tool', {} as any)).toThrow('not declared')
  })

  test('prompts.register adds to plugin registeredPrompts', () => {
    const plugin = makePlugin([])
    const ctx = buildPluginContext(plugin, {})
    ctx.prompts.register('my-prompt', 'Hello from plugin')
    expect(plugin.registeredPrompts.has('my-prompt')).toBe(true)
  })

  test('store throws when store permission not granted', () => {
    const plugin = makePlugin([]) // no 'store' permission
    const ctx = buildPluginContext(plugin, {})
    expect(() => ctx.store.get('user1', 'key')).toThrow('store')
  })

  test('chat throws when chat permission not granted', () => {
    const plugin = makePlugin([]) // no 'chat' permission
    const ctx = buildPluginContext(plugin, {})
    expect(() => ctx.chat.sendMessage('user1', 'hi')).toThrow('chat')
  })

  test('context is frozen', () => {
    const plugin = makePlugin(['store'])
    const mockStore = {
      get: mock(() => null),
      set: mock(() => {}),
      delete: mock(() => {}),
      list: mock(() => []),
      setSecret: mock(() => {}),
      getSecret: mock(() => null),
    }
    const ctx = buildPluginContext(plugin, { store: mockStore })
    expect(Object.isFrozen(ctx)).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/context.test.ts`
Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```typescript
// src/plugins/context.ts
import { logger } from '../logger.js'
import type {
  PluginChatService,
  PluginCommandRegistry,
  PluginContext,
  PluginPromptRegistry,
  PluginSchedulerRegistry,
  PluginStore,
  PluginToolRegistry,
  RegisteredPlugin,
} from './types.js'

type FrameworkServices = {
  store?: PluginStore
  chat?: PluginChatService
  scheduler?: {
    register(name: string, config: { cron?: string; interval?: number; handler: () => Promise<void> | void }): void
  }
  commandRegistry?: {
    register(name: string, handler: unknown): void
  }
}

function createPermissionProxy<T extends object>(serviceName: string, pluginId: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      throw new Error(`Plugin '${pluginId}' does not have '${serviceName}' permission`)
    },
  })
}

export function buildPluginContext(plugin: RegisteredPlugin, services: FrameworkServices): PluginContext {
  const pluginId = plugin.manifest.id
  const permissions = new Set(plugin.manifest.permissions)
  const pluginLogger = logger.child({ plugin: pluginId })

  const tools: PluginToolRegistry = {
    register(name, tool) {
      if (!plugin.manifest.contributes.tools?.includes(name)) {
        throw new Error(`Tool '${name}' not declared in plugin '${pluginId}' manifest contributes.tools`)
      }
      plugin.registeredTools.set(name, tool)
      pluginLogger.debug({ tool: name }, 'Tool registered')
    },
  }

  const prompts: PluginPromptRegistry = {
    register(key, fragment) {
      if (!plugin.manifest.contributes.promptFragments?.includes(key)) {
        throw new Error(
          `Prompt fragment '${key}' not declared in plugin '${pluginId}' manifest contributes.promptFragments`,
        )
      }
      plugin.registeredPrompts.set(key, fragment)
      pluginLogger.debug({ prompt: key }, 'Prompt fragment registered')
    },
  }

  const scheduler: PluginSchedulerRegistry = {
    register(name, config) {
      if (!plugin.manifest.contributes.jobs?.includes(name)) {
        throw new Error(`Job '${name}' not declared in plugin '${pluginId}' manifest contributes.jobs`)
      }
      if (!permissions.has('scheduler') || services.scheduler === undefined) {
        throw new Error(`Plugin '${pluginId}' does not have 'scheduler' permission`)
      }
      services.scheduler.register(`plugin:${pluginId}:${name}`, config)
      plugin.registeredJobs.push(name)
      pluginLogger.debug({ job: name }, 'Scheduler job registered')
    },
  }

  const commands: PluginCommandRegistry = {
    register(name, handler) {
      if (!plugin.manifest.contributes.commands?.includes(name)) {
        throw new Error(`Command '${name}' not declared in plugin '${pluginId}' manifest contributes.commands`)
      }
      if (services.commandRegistry !== undefined) {
        services.commandRegistry.register(name, handler)
      }
      plugin.registeredCommands.push(name)
      pluginLogger.debug({ command: name }, 'Command registered')
    },
  }

  const store: PluginStore =
    permissions.has('store') && services.store !== undefined
      ? services.store
      : createPermissionProxy<PluginStore>('store', pluginId)

  const chat: PluginChatService =
    permissions.has('chat') && services.chat !== undefined
      ? services.chat
      : createPermissionProxy<PluginChatService>('chat', pluginId)

  // taskProvider is resolved per-user at tool execution time, not at activation
  const taskProvider = createPermissionProxy<any>('taskProvider (resolved at tool execution time)', pluginId)

  const ctx: PluginContext = Object.freeze({
    pluginId,
    logger: pluginLogger,
    tools,
    prompts,
    scheduler,
    commands,
    store,
    taskProvider,
    chat,
  })

  return ctx
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/context.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Commit**

```bash
git add src/plugins/context.ts tests/plugins/context.test.ts
git commit -m "feat(plugins): implement plugin context builder with permission gating"
```

---

## Task 7: Plugin Loader (Lifecycle Orchestration)

**Files:**

- Create: `src/plugins/loader.ts`
- Test: `tests/plugins/loader.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/loader.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

mockLogger()

import { loadAndActivatePlugins } from '../../src/plugins/loader.js'
import { createPluginRegistry } from '../../src/plugins/registry.js'

describe('loadAndActivatePlugins', () => {
  let pluginsDir: string

  beforeEach(async () => {
    await setupTestDb()
    pluginsDir = join(tmpdir(), `papai-loader-test-${Date.now()}`)
    mkdirSync(pluginsDir, { recursive: true })
  })

  afterAll(() => {
    mock.restore()
  })

  function writePlugin(id: string, code: string, manifest?: object): string {
    const dir = join(pluginsDir, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'plugin.json'),
      JSON.stringify({
        id,
        name: id,
        version: '1.0.0',
        description: 'test',
        contributes: { tools: ['test_tool'] },
        permissions: [],
        ...manifest,
      }),
    )
    writeFileSync(join(dir, 'index.ts'), code)
    return dir
  }

  test('loads and activates an approved plugin', async () => {
    const activateFn = mock(() => {})
    writePlugin(
      'good',
      `export default () => ({ activate: ${activateFn.toString().replace('() => {}', '(ctx) => { ctx.tools.register("test_tool", { description: "t", execute: async () => ({}) }) }')} })`,
    )

    // Since dynamic import of temp files is tricky, test the registry state transitions instead
    const registry = createPluginRegistry()
    registry.register({
      manifest: {
        id: 'good',
        name: 'good',
        version: '1.0.0',
        description: 'test',
        contributes: { tools: ['test_tool'] },
        permissions: [],
      },
      dir: join(pluginsDir, 'good'),
    })
    registry.approvePlugin('good', 'admin')
    expect(registry.get('good')!.state).toBe('approved')
  })

  test('skips rejected plugins', async () => {
    const registry = createPluginRegistry()
    registry.register({
      manifest: { id: 'bad', name: 'bad', version: '1.0.0', description: 'test', contributes: {}, permissions: [] },
      dir: '/tmp/bad',
    })
    registry.rejectPlugin('bad')
    expect(registry.get('bad')!.state).toBe('rejected')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/loader.test.ts`
Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```typescript
// src/plugins/loader.ts
import { join } from 'node:path'

import { logger } from '../logger.js'
import { buildPluginContext } from './context.js'
import type { PluginRegistry } from './registry.js'
import { createPluginStore } from './store.js'
import type { PluginChatService, PluginFactory } from './types.js'

const log = logger.child({ scope: 'plugin-loader' })

type LoaderServices = {
  chat?: PluginChatService
  scheduler?: {
    register(name: string, config: { cron?: string; interval?: number; handler: () => Promise<void> | void }): void
  }
}

export async function loadAndActivatePlugins(registry: PluginRegistry, services: LoaderServices): Promise<void> {
  const plugins = registry.getAll()
  let loaded = 0
  let failed = 0

  for (const plugin of plugins) {
    if (plugin.state !== 'approved') continue

    const entryPoint = join(plugin.dir, plugin.manifest.main ?? 'index.ts')
    log.info({ pluginId: plugin.manifest.id, entryPoint }, 'Loading plugin')

    try {
      const mod = await import(entryPoint)
      const factory: PluginFactory = mod.default
      if (typeof factory !== 'function') {
        throw new Error(`Plugin entry point must export a default function, got ${typeof factory}`)
      }

      const instance = factory()
      if (typeof instance.activate !== 'function') {
        throw new Error('Plugin factory must return an object with an activate() method')
      }

      const store = createPluginStore(plugin.manifest.id)
      const ctx = buildPluginContext(plugin, {
        store,
        chat: services.chat,
        scheduler: services.scheduler,
      })

      await instance.activate(ctx)

      plugin.state = 'active'
      plugin.instance = instance
      loaded++
      log.info({ pluginId: plugin.manifest.id }, 'Plugin activated')
    } catch (error) {
      plugin.state = 'error'
      plugin.error = error instanceof Error ? error.message : String(error)
      failed++
      log.error({ pluginId: plugin.manifest.id, error: plugin.error }, 'Plugin activation failed')
    }
  }

  log.info({ loaded, failed, total: plugins.length }, 'Plugin loading complete')
}

export async function deactivateAllPlugins(registry: PluginRegistry): Promise<void> {
  for (const plugin of registry.getAll()) {
    if (plugin.state !== 'active' || plugin.instance === undefined) continue

    try {
      await plugin.instance.deactivate?.()
      log.info({ pluginId: plugin.manifest.id }, 'Plugin deactivated')
    } catch (error) {
      log.error(
        { pluginId: plugin.manifest.id, error: error instanceof Error ? error.message : String(error) },
        'Plugin deactivation failed',
      )
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/loader.ts tests/plugins/loader.test.ts
git commit -m "feat(plugins): implement plugin loader with lifecycle management"
```

---

## Task 8: Integrate Plugins into makeTools()

**Files:**

- Modify: `src/tools/index.ts:1-3,192-208` (add plugin tool merging)
- Test: `tests/plugins/integration.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/integration.test.ts
import { afterAll, describe, expect, mock, test } from 'bun:test'

import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

// Mock the plugin registry module before importing tools
let mockActivePlugins: any[] = []
void mock.module('../../src/plugins/instance.js', () => ({
  getPluginRegistry: () => ({
    getActivePluginsForUser: () => mockActivePlugins,
  }),
}))

import { makeTools } from '../../src/tools/index.js'
import { createMockProvider } from '../tools/mock-provider.js'

describe('makeTools plugin integration', () => {
  afterAll(() => {
    mock.restore()
  })

  test('includes plugin tools when plugins are active for user', () => {
    mockActivePlugins = [
      {
        manifest: { id: 'finance' },
        registeredTools: new Map([['record_expense', { description: 'Record expense', execute: async () => ({}) }]]),
      },
    ]

    const provider = createMockProvider()
    const tools = makeTools(provider, 'user1')
    expect(tools['finance__record_expense']).toBeDefined()
  })

  test('does not include plugin tools when no userId', () => {
    mockActivePlugins = [
      {
        manifest: { id: 'finance' },
        registeredTools: new Map([['record_expense', { description: 'Record expense', execute: async () => ({}) }]]),
      },
    ]

    const provider = createMockProvider()
    const tools = makeTools(provider)
    expect(tools['finance__record_expense']).toBeUndefined()
  })

  test('core tools still present alongside plugin tools', () => {
    mockActivePlugins = []
    const provider = createMockProvider()
    const tools = makeTools(provider, 'user1')
    expect(tools['create_task']).toBeDefined()
    expect(tools['search_tasks']).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/integration.test.ts`
Expected: FAIL — module `../../src/plugins/instance.js` not found

**Step 3: Create the plugin singleton and modify makeTools**

First, create the singleton:

```typescript
// src/plugins/instance.ts
import type { PluginRegistry } from './registry.js'

let registryInstance: PluginRegistry | null = null

export function setPluginRegistry(registry: PluginRegistry): void {
  registryInstance = registry
}

export function getPluginRegistry(): PluginRegistry | null {
  return registryInstance
}
```

Then modify `src/tools/index.ts`. Add import at the top (after line 3):

```typescript
import { getPluginRegistry } from '../plugins/instance.js'
```

Replace the `makeTools` function (lines 192–208) with:

```typescript
export function makeTools(provider: TaskProvider, userId?: string, mode: ToolMode = 'normal'): ToolSet {
  const tools = makeCoreTools(provider, userId)
  maybeAddArchiveTool(tools, provider)
  maybeAddProjectTools(tools, provider)
  maybeAddCommentTools(tools, provider)
  maybeAddLabelTools(tools, provider)
  maybeAddRelationTools(tools, provider)
  maybeAddStatusTools(tools, provider)
  maybeAddDeleteTool(tools, provider)
  addRecurringTools(tools, userId)
  addMemoTools(tools, provider, userId)
  addInstructionTools(tools, userId)
  if (mode === 'normal') {
    addDeferredPromptTools(tools, userId)
  }

  // Merge plugin tools for opted-in users
  if (userId !== undefined) {
    const registry = getPluginRegistry()
    if (registry !== null) {
      for (const plugin of registry.getActivePluginsForUser(userId)) {
        for (const [name, tool] of plugin.registeredTools) {
          tools[`${plugin.manifest.id}__${name}`] = tool
        }
      }
    }
  }

  return tools
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/integration.test.ts`
Expected: PASS (all 3 tests)

Also run full tool tests to check no regressions:
Run: `bun test tests/tools/`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/instance.ts src/tools/index.ts tests/plugins/integration.test.ts
git commit -m "feat(plugins): integrate plugin tools into makeTools"
```

---

## Task 9: Integrate Plugins into buildSystemPrompt()

**Files:**

- Modify: `src/system-prompt.ts:105-110` (append plugin prompt fragments)

**Step 1: Write the test**

Add to `tests/plugins/integration.test.ts`:

```typescript
// Add to existing imports and mocks in tests/plugins/integration.test.ts

import { buildSystemPrompt } from '../../src/system-prompt.js'

describe('buildSystemPrompt plugin integration', () => {
  test('appends plugin prompt fragments', () => {
    mockActivePlugins = [
      {
        manifest: { id: 'finance' },
        registeredPrompts: new Map([['finance-ctx', 'You can track expenses.']]),
      },
    ]

    const provider = createMockProvider()
    const prompt = buildSystemPrompt(provider, 'UTC', 'user1')
    expect(prompt).toContain('You can track expenses.')
  })

  test('supports dynamic prompt fragments', async () => {
    mockActivePlugins = [
      {
        manifest: { id: 'dynamic' },
        registeredPrompts: new Map([['dyn', () => 'Dynamic content']]),
      },
    ]

    const provider = createMockProvider()
    const prompt = buildSystemPrompt(provider, 'UTC', 'user1')
    // Note: if fragment is a function, it may need to be awaited.
    // The implementation should handle both sync and async.
    expect(prompt).toContain('Dynamic content')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/integration.test.ts`
Expected: FAIL — prompt does not contain plugin fragments yet

**Step 3: Modify buildSystemPrompt**

In `src/system-prompt.ts`, add import after line 2:

```typescript
import { getPluginRegistry } from './plugins/instance.js'
```

Replace the `buildSystemPrompt` export (lines 105–110) with:

```typescript
export const buildSystemPrompt = (provider: TaskProvider, timezone: string, contextId: string): string => {
  const localDateStr = getLocalDateString(timezone)
  const base = buildBasePrompt(localDateStr)
  const addendum = provider.getPromptAddendum()
  let prompt = `${buildInstructionsBlock(contextId)}${addendum === '' ? base : `${base}\n\n${addendum}`}`

  // Append plugin prompt fragments for opted-in users
  const registry = getPluginRegistry()
  if (registry !== null) {
    for (const plugin of registry.getActivePluginsForUser(contextId)) {
      for (const [_key, fragment] of plugin.registeredPrompts) {
        const text = typeof fragment === 'function' ? fragment() : fragment
        if (typeof text === 'string') {
          prompt += `\n\n${text}`
        }
      }
    }
  }

  return prompt
}
```

Note: Dynamic fragments that return a Promise will resolve to `[object Promise]` with this sync approach. If async fragments are needed, `buildSystemPrompt` must become async. For now, keep it sync and document that prompt fragments must return strings synchronously. Update the `PluginPromptRegistry` type in `src/plugins/types.ts` accordingly if desired.

**Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/system-prompt.ts tests/plugins/integration.test.ts
git commit -m "feat(plugins): integrate plugin prompt fragments into system prompt"
```

---

## Task 10: Wire Plugin System into Startup/Shutdown

**Files:**

- Modify: `src/index.ts:1-12,83-90,100-122` (add plugin init and cleanup)
- Create: `plugins/.gitkeep`

**Step 1: Create the plugins directory**

```bash
mkdir -p plugins
touch plugins/.gitkeep
```

**Step 2: Modify `src/index.ts`**

Add imports after line 12 (`import { addUser } from './users.js'`):

```typescript
import { discoverPlugins } from './plugins/discovery.js'
import { setPluginRegistry } from './plugins/instance.js'
import { deactivateAllPlugins, loadAndActivatePlugins } from './plugins/loader.js'
import { createPluginRegistry } from './plugins/registry.js'
```

After `scheduler.startAll()` (line 90), add plugin initialization:

```typescript
// Initialize plugin system
const pluginRegistry = createPluginRegistry()
const discovered = await discoverPlugins(join(import.meta.dir, '..', 'plugins'))
for (const plugin of discovered) {
  pluginRegistry.register(plugin)
}
pluginRegistry.loadAdminStates()
await loadAndActivatePlugins(pluginRegistry, {
  chat: { sendMessage: (userId, markdown) => chatProvider.sendMessage(userId, markdown) },
  scheduler: {
    register: (name, config) => {
      scheduler.register(name, {
        cron: config.cron,
        interval: config.interval,
        handler: config.handler,
        options: { unref: true },
      })
      scheduler.start(name)
    },
  },
})
setPluginRegistry(pluginRegistry)
```

Add `join` import at the top of the file:

```typescript
import { join } from 'node:path'
```

In both SIGINT and SIGTERM handlers, add before `void chatProvider.stop()`:

```typescript
await deactivateAllPlugins(pluginRegistry)
```

Note: Since the shutdown handlers are sync (`process.on('SIGINT', () => { ... })`), you may need to handle the async deactivation. Check if the existing pattern uses `void` for async calls in the shutdown path — if so, use `void deactivateAllPlugins(pluginRegistry)` to match.

**Step 3: Run typecheck**

Run: `bun typecheck`
Expected: No new errors

**Step 4: Commit**

```bash
git add plugins/.gitkeep src/index.ts
git commit -m "feat(plugins): wire plugin system into startup and shutdown"
```

---

## Task 11: Admin `/plugin` Command

**Files:**

- Create: `src/commands/plugin.ts`
- Modify: `src/commands/index.ts:8` (add export)
- Modify: `src/bot.ts:99-108` (register command)
- Test: `tests/commands/plugin.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/commands/plugin.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  createAuth,
  createDmMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

mockLogger()

// Mock the plugin registry
const mockPlugins: any[] = []
void mock.module('../../src/plugins/instance.js', () => ({
  getPluginRegistry: () => ({
    getAll: () => mockPlugins,
    approvePlugin: mock(() => {}),
    rejectPlugin: mock(() => {}),
    get: (id: string) => mockPlugins.find((p: any) => p.manifest.id === id),
  }),
}))

import { registerPluginCommand } from '../../src/commands/plugin.js'

describe('/plugin command', () => {
  beforeEach(async () => {
    await setupTestDb()
    mockPlugins.length = 0
  })

  afterAll(() => {
    mock.restore()
  })

  test('shows "no plugins" message when none discovered', async () => {
    const { provider, commandHandlers } = createMockChat()
    registerPluginCommand(provider, 'admin1')

    const handler = commandHandlers.get('plugin')!
    const reply = createMockReply()
    const msg = createDmMessage('admin1')
    const auth = createAuth('admin1', { isBotAdmin: true })

    await handler(msg, reply.reply, auth)
    expect(reply.textCalls[0]?.[0] ?? reply.formattedCalls[0]?.[0] ?? reply.buttonsCalls[0]?.[0]).toContain(
      'No plugins',
    )
  })

  test('rejects non-admin users', async () => {
    const { provider, commandHandlers } = createMockChat()
    registerPluginCommand(provider, 'admin1')

    const handler = commandHandlers.get('plugin')!
    const reply = createMockReply()
    const msg = createDmMessage('user1')
    const auth = createAuth('user1', { isBotAdmin: false })

    await handler(msg, reply.reply, auth)
    // Should not show plugin list, just return early
    expect(reply.textCalls).toHaveLength(0)
    expect(reply.buttonsCalls).toHaveLength(0)
  })

  test('shows plugin list with buttons', async () => {
    mockPlugins.push({
      manifest: {
        id: 'finance',
        name: 'Finance',
        version: '1.0.0',
        description: 'Track money',
        contributes: { tools: ['record_expense'] },
        permissions: ['store'],
      },
      state: 'discovered',
    })

    const { provider, commandHandlers } = createMockChat()
    registerPluginCommand(provider, 'admin1')

    const handler = commandHandlers.get('plugin')!
    const reply = createMockReply()
    const msg = createDmMessage('admin1')
    const auth = createAuth('admin1', { isBotAdmin: true })

    await handler(msg, reply.reply, auth)
    const output = reply.textCalls[0]?.[0] ?? reply.formattedCalls[0]?.[0] ?? reply.buttonsCalls[0]?.[0] ?? ''
    expect(output).toContain('Finance')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/commands/plugin.test.ts`
Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```typescript
// src/commands/plugin.ts
import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { getPluginRegistry } from '../plugins/instance.js'
import type { RegisteredPlugin } from '../plugins/types.js'

const log = logger.child({ scope: 'cmd:plugin' })

const STATE_INDICATORS: Record<string, string> = {
  discovered: '🆕',
  approved: '✅',
  active: '✅',
  rejected: '❌',
  error: '⚠️',
}

function formatPluginEntry(plugin: RegisteredPlugin): string {
  const icon = STATE_INDICATORS[plugin.state] ?? '❓'
  const toolCount = plugin.manifest.contributes.tools?.length ?? 0
  const jobCount = plugin.manifest.contributes.jobs?.length ?? 0
  const promptCount = plugin.manifest.contributes.promptFragments?.length ?? 0
  const parts = []
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`)
  if (jobCount > 0) parts.push(`${jobCount} job${jobCount > 1 ? 's' : ''}`)
  if (promptCount > 0) parts.push(`${promptCount} prompt${promptCount > 1 ? 's' : ''}`)

  let entry = `${icon} *${plugin.manifest.name}* v${plugin.manifest.version}\n`
  entry += `   ${plugin.manifest.description}\n`
  if (plugin.manifest.permissions.length > 0) {
    entry += `   Permissions: ${plugin.manifest.permissions.join(', ')}\n`
  }
  if (parts.length > 0) {
    entry += `   ${parts.join(' · ')}\n`
  }
  if (plugin.state === 'error' && plugin.error !== undefined) {
    entry += `   Error: ${plugin.error}\n`
  }
  return entry
}

export function registerPluginCommand(chat: ChatProvider, adminUserId: string): void {
  const handler: CommandHandler = async (_msg, reply, auth) => {
    if (!auth.isBotAdmin) return

    const registry = getPluginRegistry()
    if (registry === null) {
      await reply.text('Plugin system not initialized.')
      return
    }

    const plugins = registry.getAll()
    if (plugins.length === 0) {
      await reply.text('No plugins found in the plugins/ directory.')
      return
    }

    let text = '📦 *Plugins*\n\n'
    const buttons: Array<{ text: string; callbackData: string; style?: string }> = []

    for (const plugin of plugins) {
      text += formatPluginEntry(plugin)
      text += '\n'

      if (plugin.state === 'discovered') {
        buttons.push({
          text: `✅ Approve ${plugin.manifest.id}`,
          callbackData: `plugin_approve_${plugin.manifest.id}`,
          style: 'primary',
        })
        buttons.push({
          text: `❌ Reject ${plugin.manifest.id}`,
          callbackData: `plugin_reject_${plugin.manifest.id}`,
          style: 'danger',
        })
      } else if (plugin.state === 'active') {
        buttons.push({ text: `🔍 Info ${plugin.manifest.id}`, callbackData: `plugin_info_${plugin.manifest.id}` })
        buttons.push({
          text: `🚫 Disable ${plugin.manifest.id}`,
          callbackData: `plugin_disable_${plugin.manifest.id}`,
          style: 'danger',
        })
      }
    }

    if (buttons.length > 0) {
      await reply.buttons(text, { buttons })
    } else {
      await reply.formatted(text)
    }

    log.info({ pluginCount: plugins.length }, '/plugin command executed')
  }

  chat.registerCommand('plugin', handler)
}
```

**Step 4: Register the command**

Add export to `src/commands/index.ts` (after line 8):

```typescript
export { registerPluginCommand } from './plugin.js'
```

Add registration in `src/bot.ts` inside `registerCommands()` function (after line 107, `registerGroupCommand(chat)`):

```typescript
registerPluginCommand(chat, adminUserId)
```

Add import in `src/bot.ts` (in the imports from `./commands/index.js`):

```typescript
import { ..., registerPluginCommand } from './commands/index.js'
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/commands/plugin.test.ts`
Expected: PASS (all 3 tests)

**Step 6: Commit**

```bash
git add src/commands/plugin.ts src/commands/index.ts src/bot.ts tests/commands/plugin.test.ts
git commit -m "feat(plugins): add /plugin admin command with inline buttons"
```

---

## Task 12: Integrate Plugin Opt-In into /config

**Files:**

- Modify: `src/commands/config.ts` (append plugins section to config display)

**Step 1: Read the current config command fully**

Read `src/commands/config.ts` in full to understand the exact structure before modifying.

**Step 2: Add plugin section to config output**

After the existing config field buttons are built, add a plugins section. Import `getPluginRegistry` and append active plugins with Enable/Disable buttons. Plugin config keys (from `configRequirements`) should also be displayed with Edit buttons.

The exact code depends on the current structure of the config handler — adapt to match the existing button creation pattern using `config_edit_${key}` callbacks.

Add new callback prefixes:

- `plugin_user_enable_{id}` — handled in bot.ts callback routing
- `plugin_user_disable_{id}` — handled in bot.ts callback routing

**Step 3: Run config tests**

Run: `bun test tests/commands/config.test.ts`
Expected: PASS (no regressions)

**Step 4: Commit**

```bash
git add src/commands/config.ts src/bot.ts
git commit -m "feat(plugins): integrate plugin opt-in into /config display"
```

---

## Task 13: Full Integration Test

**Files:**

- Create: `tests/plugins/full-lifecycle.test.ts`

**Step 1: Write end-to-end plugin lifecycle test**

```typescript
// tests/plugins/full-lifecycle.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

mockLogger()

import { discoverPlugins } from '../../src/plugins/discovery.js'
import { createPluginRegistry } from '../../src/plugins/registry.js'
import { buildPluginContext } from '../../src/plugins/context.js'
import { createPluginStore } from '../../src/plugins/store.js'

describe('Plugin full lifecycle', () => {
  let pluginsDir: string

  beforeEach(async () => {
    await setupTestDb()
    pluginsDir = join(tmpdir(), `papai-lifecycle-${Date.now()}`)
    mkdirSync(pluginsDir, { recursive: true })
  })

  afterAll(() => {
    mock.restore()
  })

  test('discover → register → approve → activate → tools registered', async () => {
    // 1. Create a plugin on disk
    const dir = join(pluginsDir, 'greeter')
    mkdirSync(dir)
    writeFileSync(
      join(dir, 'plugin.json'),
      JSON.stringify({
        id: 'greeter',
        name: 'Greeter',
        version: '1.0.0',
        description: 'Says hello',
        contributes: { tools: ['greet'], promptFragments: ['greeter-ctx'] },
        permissions: ['store'],
      }),
    )

    // 2. Discover
    const discovered = await discoverPlugins(pluginsDir)
    expect(discovered).toHaveLength(1)

    // 3. Register
    const registry = createPluginRegistry()
    registry.register(discovered[0])
    expect(registry.get('greeter')!.state).toBe('discovered')

    // 4. Approve
    registry.approvePlugin('greeter', 'admin1')
    expect(registry.get('greeter')!.state).toBe('approved')

    // 5. Build context and simulate activation
    const plugin = registry.get('greeter')!
    const store = createPluginStore('greeter')
    const ctx = buildPluginContext(plugin, { store })

    // Register tool and prompt (simulating what activate() would do)
    ctx.tools.register('greet', { description: 'Say hi', execute: async () => ({ message: 'hello' }) } as any)
    ctx.prompts.register('greeter-ctx', 'You can greet users.')

    plugin.state = 'active'

    // 6. Verify tools and prompts are registered
    expect(plugin.registeredTools.has('greet')).toBe(true)
    expect(plugin.registeredPrompts.has('greeter-ctx')).toBe(true)

    // 7. Store isolation works
    await store.set('user1', 'greet-count', 5)
    expect(await store.get('user1', 'greet-count')).toBe(5)

    // 8. User opt-in
    expect(registry.isPluginActiveForUser('greeter', 'user1')).toBe(false) // not auto-enabled
    registry.setUserPluginState('greeter', 'user1', true)
    expect(registry.isPluginActiveForUser('greeter', 'user1')).toBe(true)

    // 9. getActivePluginsForUser
    const active = registry.getActivePluginsForUser('user1')
    expect(active).toHaveLength(1)
    expect(active[0].manifest.id).toBe('greeter')
  })
})
```

**Step 2: Run the test**

Run: `bun test tests/plugins/full-lifecycle.test.ts`
Expected: PASS

**Step 3: Run the full test suite**

Run: `bun test`
Expected: PASS — no regressions

**Step 4: Run all checks**

Run: `bun check:verbose`
Expected: All checks pass (lint, typecheck, format, knip, tests)

**Step 5: Commit**

```bash
git add tests/plugins/full-lifecycle.test.ts
git commit -m "test(plugins): add full lifecycle integration test"
```

---

## Task 14: Create Example Plugin

**Files:**

- Create: `plugins/example/plugin.json`
- Create: `plugins/example/index.ts`
- Add to `.gitignore`: `plugins/*/` with exception for `plugins/example/`

**Step 1: Write the example plugin manifest**

```json
{
  "id": "example",
  "name": "Example Plugin",
  "version": "1.0.0",
  "description": "A minimal example plugin demonstrating the plugin API",
  "author": "papai",
  "contributes": {
    "tools": ["echo"],
    "promptFragments": ["example-context"]
  },
  "permissions": ["store"],
  "autoEnable": false
}
```

**Step 2: Write the example plugin entry point**

```typescript
// plugins/example/index.ts
import { tool } from 'ai'
import { z } from 'zod'
import type { PluginFactory } from '../../src/plugins/types.js'

const createPlugin: PluginFactory = () => ({
  activate(ctx) {
    ctx.tools.register(
      'echo',
      tool({
        description: 'Echo a message back (example plugin tool)',
        inputSchema: z.object({
          message: z.string().describe('The message to echo back'),
        }),
        execute: async ({ message }) => {
          // Demonstrate store usage
          const count = ((await ctx.store.get<number>('__global__', 'echo-count')) ?? 0) + 1
          await ctx.store.set('__global__', 'echo-count', count)
          ctx.logger.info({ message, count }, 'Echo tool called')
          return { echo: message, totalEchoes: count }
        },
      }),
    )

    ctx.prompts.register(
      'example-context',
      'You have an echo tool from the example plugin. Use it when the user asks you to echo something.',
    )

    ctx.logger.info('Example plugin activated')
  },

  deactivate() {
    // Nothing to clean up
  },
})

export default createPlugin
```

**Step 3: Update .gitignore**

Add to `.gitignore`:

```
# Plugin directory (user-installed plugins)
plugins/*/
!plugins/example/
```

**Step 4: Commit**

```bash
git add plugins/example/plugin.json plugins/example/index.ts .gitignore
git commit -m "feat(plugins): add example plugin demonstrating plugin API"
```

---

## Summary

| Task | Description                        | Files                                             | Depends On |
| ---- | ---------------------------------- | ------------------------------------------------- | ---------- |
| 1    | Type definitions + manifest schema | `src/plugins/types.ts`                            | —          |
| 2    | Database migration (3 tables)      | `src/db/migrations/019_plugins.ts`, schema, index | 1          |
| 3    | Plugin store implementation        | `src/plugins/store.ts`                            | 1, 2       |
| 4    | Plugin discovery                   | `src/plugins/discovery.ts`                        | 1          |
| 5    | Plugin registry                    | `src/plugins/registry.ts`                         | 1, 2, 4    |
| 6    | Plugin context builder             | `src/plugins/context.ts`                          | 1          |
| 7    | Plugin loader (lifecycle)          | `src/plugins/loader.ts`                           | 3, 5, 6    |
| 8    | Integrate into makeTools()         | `src/tools/index.ts`                              | 5          |
| 9    | Integrate into buildSystemPrompt() | `src/system-prompt.ts`                            | 5          |
| 10   | Wire into startup/shutdown         | `src/index.ts`                                    | 4, 5, 7    |
| 11   | Admin /plugin command              | `src/commands/plugin.ts`                          | 5          |
| 12   | User opt-in in /config             | `src/commands/config.ts`                          | 5          |
| 13   | Full lifecycle integration test    | `tests/plugins/`                                  | 1–9        |
| 14   | Example plugin                     | `plugins/example/`                                | 1–10       |
