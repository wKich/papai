# Demo Auto-Provisioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When `DEMO_MODE=true`, automatically add, Kaneo-provision, and pre-fill LLM config for any unknown user who messages or `/start`s the bot.

**Architecture:** Intercept in `checkAuthorizationExtended()` in `src/bot.ts` to auto-add unknown DM users. Reuse existing `provisionAndConfigure()` for Kaneo account creation. New `copyAdminLlmConfig()` copies the admin's LLM settings to new users. Config copy happens inside `maybeProvisionKaneo()` after successful provisioning.

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

    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBe('sk-admin-key')
    expect(getConfig(TARGET_ID, 'llm_baseurl')).toBe('https://api.example.com/v1')
    expect(getConfig(TARGET_ID, 'main_model')).toBe('gpt-4o')
    expect(getConfig(TARGET_ID, 'small_model')).toBe('gpt-4o-mini')
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
const LLM_COPY_KEYS: readonly ConfigKey[] = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model']

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

### Task 2: Add demo mode auto-add to `checkAuthorizationExtended()`

**Files:**

- Modify: `src/bot.ts`
- Test: `tests/bot-auth.test.ts`

**Step 1: Write the failing tests**

Add a new describe block to `tests/bot-auth.test.ts`:

```typescript
describe('Demo Mode Auto-Provision', () => {
  const DEMO_USER_ID = 'demo-user-1'
  const DEMO_USERNAME = 'demouser'

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  test('demo mode: unknown DM user is auto-added and authorized', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: DEMO_USER_ID,
    })
    expect(isAuthorized(DEMO_USER_ID)).toBe(true)
    delete process.env['DEMO_MODE']
  })

  test('demo mode: unknown DM user without username is auto-added', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended(DEMO_USER_ID, null, DEMO_USER_ID, 'dm', false)
    expect(result.allowed).toBe(true)
    expect(isAuthorized(DEMO_USER_ID)).toBe(true)
    delete process.env['DEMO_MODE']
  })

  test('demo mode: group messages from unknown users are NOT auto-added', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', false)
    expect(result.allowed).toBe(false)
    delete process.env['DEMO_MODE']
  })

  test('demo mode off: unknown DM user is NOT auto-added', () => {
    delete process.env['DEMO_MODE']
    const result = checkAuthorizationExtended('stranger-1', 'stranger', 'stranger-1', 'dm', false)
    expect(result.allowed).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/bot-auth.test.ts`
Expected: FAIL — demo mode tests fail because unknown users are not auto-added

**Step 3: Write minimal implementation**

In `src/bot.ts`, add the demo mode constant near the top (after the existing `log` line):

```typescript
const DEMO_MODE = process.env['DEMO_MODE'] === 'true'
```

Then in `checkAuthorizationExtended()`, add this block before the existing `if (isAuthorized(userId))` check:

```typescript
if (DEMO_MODE && !isAuthorized(userId) && contextType === 'dm') {
  log.info({ userId, username }, 'Demo mode: auto-adding user')
  addUser(userId, 'demo-auto', username ?? undefined)
}
```

Add `addUser` to the imports from `./users.js` if not already there (it is not — currently only `isAuthorized` and `resolveUserByUsername` are imported).

**Step 4: Run test to verify it passes**

Run: `bun test tests/bot-auth.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/bot.ts tests/bot-auth.test.ts
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

Add import at top:

```typescript
import { copyAdminLlmConfig } from './config.js'
```

After the successful provisioning block inside `maybeProvisionKaneo`, add:

```typescript
if (outcome.status === 'provisioned') {
  const adminUserId = process.env['ADMIN_USER_ID']
  if (adminUserId !== undefined && adminUserId !== '') {
    copyAdminLlmConfig(contextId, adminUserId)
  }
  await reply.text(...)
}
```

Also add config copy for the case where Kaneo is already provisioned but LLM config is missing. At the top of `maybeProvisionKaneo`, after the early return when both workspace and apikey exist, add:

```typescript
const missingLlmKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const
const needsLlmConfig = missingLlmKeys.some((k) => getConfig(contextId, k) === null)
if (!needsLlmConfig) return

const adminUserId = process.env['ADMIN_USER_ID']
if (adminUserId !== undefined && adminUserId !== '') {
  copyAdminLlmConfig(contextId, adminUserId)
}
```

This handles both cases: fresh provisioning and already-provisioned but missing LLM config.

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
