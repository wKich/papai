# Demo Auto-Provisioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When `DEMO_MODE=true`, automatically add, Kaneo-provision, and pre-fill LLM config for any unknown user who messages or `/start`s the bot.

**Architecture:** Intercept in `checkAuthorizationExtended()` in `src/bot.ts` to auto-add unknown DM users, returning non-admin auth (`isBotAdmin: false`). New `isDemoUser()` in `src/users.ts` ensures demo users stay non-admin on subsequent messages. The `/start` command handler also auto-adds demo users (commands bypass `checkAuthorizationExtended`). Reuse existing `provisionAndConfigure()` for Kaneo account creation. New `copyAdminLlmConfig()` copies the admin's LLM settings to new users. Config copy happens inside `maybeProvisionKaneo()` after successful provisioning, guarded by `DEMO_MODE`.

**Tech Stack:** Bun, TypeScript, SQLite (Drizzle), existing test helpers.

---

### Task 1: Add `copyAdminLlmConfig()` to `src/config.ts`

**Files:**

- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

**Step 1: Write the failing test**

Add to `tests/config.test.ts` after the `maskValue` describe block:

```typescript
describe('copyAdminLlmConfig', () => {
  const ADMIN_ID = 'admin-001'
  const TARGET_ID = 'target-002'

  beforeEach(async () => {
    testDb = await setupTestDb()
    clearUserCache(ADMIN_ID)
    clearUserCache(TARGET_ID)
  })

  test('copies LLM config keys from admin to target user', () => {
    setConfig(ADMIN_ID, 'llm_apikey', 'sk-admin-key')
    setConfig(ADMIN_ID, 'llm_baseurl', 'https://api.example.com/v1')
    setConfig(ADMIN_ID, 'main_model', 'gpt-4o')
    setConfig(ADMIN_ID, 'small_model', 'gpt-4o-mini')
    setConfig(ADMIN_ID, 'embedding_model', 'text-embedding-3-small')

    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBe('sk-admin-key')
    expect(getConfig(TARGET_ID, 'llm_baseurl')).toBe('https://api.example.com/v1')
    expect(getConfig(TARGET_ID, 'main_model')).toBe('gpt-4o')
    expect(getConfig(TARGET_ID, 'small_model')).toBe('gpt-4o-mini')
    expect(getConfig(TARGET_ID, 'embedding_model')).toBe('text-embedding-3-small')
  })

  test('skips keys the admin has not set', () => {
    setConfig(ADMIN_ID, 'llm_apikey', 'sk-key')
    setConfig(ADMIN_ID, 'llm_baseurl', 'https://api.example.com/v1')
    setConfig(ADMIN_ID, 'main_model', 'gpt-4o')

    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBe('sk-key')
    expect(getConfig(TARGET_ID, 'small_model')).toBeNull()
  })

  test('is a no-op when admin has no config', () => {
    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBeNull()
    expect(getConfig(TARGET_ID, 'llm_baseurl')).toBeNull()
  })

  test('does not overwrite existing target config', () => {
    setConfig(ADMIN_ID, 'llm_apikey', 'admin-key')
    setConfig(ADMIN_ID, 'main_model', 'gpt-4o')
    setConfig(TARGET_ID, 'llm_apikey', 'existing-target-key')

    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBe('existing-target-key')
    expect(getConfig(TARGET_ID, 'main_model')).toBe('gpt-4o')
  })
})
```

Add the import for `copyAdminLlmConfig` at the top of the test file alongside the existing imports from `../src/config.js`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/config.test.ts`
Expected: FAIL — `copyAdminLlmConfig` is not exported from `src/config.js`

**Step 3: Write minimal implementation**

Add to `src/config.ts`:

```typescript
const LLM_COPY_KEYS: readonly ConfigKey[] = [
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
  'embedding_model',
]

export function copyAdminLlmConfig(targetUserId: string, adminUserId: string): void {
  log.debug({ targetUserId, adminUserId }, 'copyAdminLlmConfig called')
  for (const key of LLM_COPY_KEYS) {
    const existingValue = getCachedConfig(targetUserId, key)
    if (existingValue !== null) continue
    const adminValue = getCachedConfig(adminUserId, key)
    if (adminValue === null) continue
    setCachedConfig(targetUserId, key, adminValue)
  }
  log.info({ targetUserId }, 'LLM config copied from admin')
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add copyAdminLlmConfig for demo mode"
```

---

### Task 2: Add demo mode auto-add to `checkAuthorizationExtended()` and `/start`

**Files:**

- Modify: `src/bot.ts`, `src/users.ts`, `src/commands/start.ts`
- Test: `tests/bot-auth.test.ts`

**Step 1: Write the failing tests**

Add `isAuthorized` to the existing import from `../src/users.js`:

```typescript
import { addUser, isAuthorized } from '../src/users.js'
```

Add a new describe block to `tests/bot-auth.test.ts`:

```typescript
describe('Demo Mode Auto-Provision', () => {
  const DEMO_USER_ID = 'demo-user-1'
  const DEMO_USERNAME = 'demouser'

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  afterEach(() => {
    delete process.env['DEMO_MODE']
  })

  test('demo mode: unknown DM user is auto-added with non-admin auth', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: DEMO_USER_ID,
    })
    expect(isAuthorized(DEMO_USER_ID)).toBe(true)
  })

  test('demo mode: demo user stays non-admin on subsequent messages', () => {
    process.env['DEMO_MODE'] = 'true'
    // First message — auto-add
    checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', false)
    // Second message — user already authorized
    const result = checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: DEMO_USER_ID,
    })
  })

  test('demo mode: unknown DM user without username is auto-added', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended(DEMO_USER_ID, null, DEMO_USER_ID, 'dm', false)
    expect(result.allowed).toBe(true)
    expect(result.isBotAdmin).toBe(false)
    expect(isAuthorized(DEMO_USER_ID)).toBe(true)
  })

  test('demo mode: manually-added user retains bot admin auth', () => {
    process.env['DEMO_MODE'] = 'true'
    addUser('manual-user', 'admin', 'manualuser')
    const result = checkAuthorizationExtended('manual-user', 'manualuser', 'manual-user', 'dm', false)
    expect(result.isBotAdmin).toBe(true)
  })

  test('demo mode: group messages from unknown users are NOT auto-added', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', false)
    expect(result.allowed).toBe(false)
  })

  test('demo mode off: unknown DM user is NOT auto-added', () => {
    const result = checkAuthorizationExtended('stranger-1', 'stranger', 'stranger-1', 'dm', false)
    expect(result.allowed).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/bot-auth.test.ts`
Expected: FAIL — demo mode tests fail because unknown users are not auto-added

**Step 3: Write minimal implementation**

**3a. Add `isDemoUser()` to `src/users.ts`:**

```typescript
export function isDemoUser(userId: string): boolean {
  log.debug({ userId }, 'isDemoUser called')
  const db = getDrizzleDb()
  const row = db.select({ addedBy: users.addedBy }).from(users).where(eq(users.platformUserId, userId)).get()
  return row?.addedBy === 'demo-auto'
}
```

**3b. Add demo auth helper and update `checkAuthorizationExtended()` in `src/bot.ts`:**

Add a new helper alongside the existing auth helpers:

```typescript
const getDemoUserAuth = (userId: string): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: userId,
})
```

Add `addUser` and `isDemoUser` to the imports from `./users.js`:

```typescript
import { addUser, isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'
```

Then in `checkAuthorizationExtended()`, add this block **before** the existing `if (isAuthorized(userId))` check:

```typescript
if (process.env['DEMO_MODE'] === 'true' && !isAuthorized(userId) && contextType === 'dm') {
  log.info({ userId, username }, 'Demo mode: auto-adding user')
  addUser(userId, 'demo-auto', username ?? undefined)
  return getDemoUserAuth(userId)
}
```

> **Why inline `process.env` instead of a module constant?** A module-level `const DEMO_MODE = process.env['DEMO_MODE'] === 'true'` is evaluated once at import time. Tests that set `process.env['DEMO_MODE']` after module load would never see the change.

Then, inside the existing `if (isAuthorized(userId))` block, add the demo user check so that demo users stay non-admin on subsequent messages:

```typescript
if (isAuthorized(userId)) {
  if (contextType === 'dm' && isDemoUser(userId)) {
    return getDemoUserAuth(userId)
  }
  return getBotAdminAuth(userId, contextId, contextType, isPlatformAdmin)
}
```

**3c. Add demo auto-add to `/start` command handler in `src/commands/start.ts`:**

Commands registered via `ChatProvider.registerCommand()` bypass `checkAuthorizationExtended()` entirely — the Telegram adapter creates its own `AuthorizationResult` with `allowed: true`. So `/start` must also auto-add demo users.

Add imports at top of `src/commands/start.ts`:

```typescript
import { addUser, isAuthorized } from '../users.js'
```

Add this block at the top of the handler, before the `auth.allowed` check:

```typescript
if (process.env['DEMO_MODE'] === 'true' && msg.contextType === 'dm' && !isAuthorized(msg.user.id)) {
  addUser(msg.user.id, 'demo-auto', msg.user.username ?? undefined)
  log.info({ userId: msg.user.id }, 'Demo mode: auto-added user via /start')
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/bot-auth.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/bot.ts src/users.ts src/commands/start.ts tests/bot-auth.test.ts
git commit -m "feat: auto-add unknown DM users in demo mode"
```

---

### Task 3: Call `copyAdminLlmConfig()` after Kaneo provisioning

**Files:**

- Modify: `src/llm-orchestrator.ts`
- Test: `tests/llm-orchestrator-process.test.ts` (extend existing test)

**Step 1: Read existing orchestrator test**

Read `tests/llm-orchestrator-process.test.ts` to understand how `maybeProvisionKaneo` is mocked and where to add new tests.

**Step 2: Write the failing test**

Add a test case that verifies when `maybeProvisionKaneo` succeeds and the user has no LLM config, `copyAdminLlmConfig` is called. Mock `copyAdminLlmConfig` as a spy to track calls.

Since `maybeProvisionKaneo` is a module-private function not exported, the test must verify the behavior through the public `processMessage()` function. The test should:

1. Set up admin with LLM config
2. Set up a demo user with Kaneo provisioned but no LLM config
3. Call `processMessage()` and verify the user gets the admin's LLM config copied
4. Verify this by checking the user's config values after the call

Alternatively, since the orchestrator test already mocks `provisionAndConfigure`, add a mock for `copyAdminLlmConfig` and verify it's called when provisioning succeeds. Check the existing test file's mock structure and follow the same `let impl` pattern.

**Step 3: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator-process.test.ts`
Expected: FAIL — `copyAdminLlmConfig` is not called

**Step 4: Write minimal implementation**

In `src/llm-orchestrator.ts`, modify `maybeProvisionKaneo()`:

Add `copyAdminLlmConfig` to the existing `./config.js` import:

```typescript
import { copyAdminLlmConfig, getConfig } from './config.js'
```

The current early return is:

```typescript
if (getKaneoWorkspace(contextId) !== null && getConfig(contextId, 'kaneo_apikey') !== null) return
```

Replace it with a conditional block that handles the already-provisioned-but-missing-LLM-config case:

```typescript
if (getKaneoWorkspace(contextId) !== null && getConfig(contextId, 'kaneo_apikey') !== null) {
  // Already provisioned — copy LLM config if still missing (demo mode only)
  if (process.env['DEMO_MODE'] === 'true') {
    const adminUserId = process.env['ADMIN_USER_ID']
    if (adminUserId !== undefined && adminUserId !== '') {
      copyAdminLlmConfig(contextId, adminUserId)
    }
  }
  return
}
```

After the successful provisioning message inside the `outcome.status === 'provisioned'` block, add the config copy (also demo-only):

```typescript
if (outcome.status === 'provisioned') {
  if (process.env['DEMO_MODE'] === 'true') {
    const adminUserId = process.env['ADMIN_USER_ID']
    if (adminUserId !== undefined && adminUserId !== '') {
      copyAdminLlmConfig(contextId, adminUserId)
    }
  }
  await reply.text(...)
}
```

> **Why guard with `DEMO_MODE`?** Without the guard, all newly-provisioned users would silently inherit the admin's LLM config, even in non-demo deployments. The stated goal is demo-mode-only behavior.

**Step 5: Run test to verify it passes**

Run: `bun test tests/llm-orchestrator-process.test.ts`
Expected: PASS

**Step 6: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/llm-orchestrator.ts tests/llm-orchestrator-process.test.ts
git commit -m "feat: copy admin LLM config after Kaneo provisioning in demo mode"
```

---

### Task 4: Update `.env.example`

**Files:**

- Modify: `.env.example`

**Step 1: Add DEMO_MODE documentation**

Add after the `KANEO_DISABLE_REGISTRATION` section:

```
# Demo mode: when true, any user who messages the bot is automatically
# added, Kaneo-provisioned, and pre-filled with the admin's LLM config.
# Intended for demo/evaluation use. Defaults to false.
# DEMO_MODE=false
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add DEMO_MODE to .env.example"
```

---

### Task 5: Run full verification

**Step 1: Run all checks**

```bash
bun check:full
```

Expected: All checks pass

**Step 2: Run full test suite**

```bash
bun test
```

Expected: All tests pass
