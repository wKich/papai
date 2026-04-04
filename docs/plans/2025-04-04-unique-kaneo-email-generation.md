# Unique Kaneo Email Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modify Kaneo user provisioning to generate unique email addresses on each registration, preventing conflicts when re-adding users after `/user remove`.

**Architecture:** Change the email generation from deterministic (`{userId}@pap.ai`) to unique per-registration by appending a short random suffix. This ensures each `/user add` creates a fresh Kaneo account without "email already exists" conflicts.

**Tech Stack:** TypeScript, Bun, Zod

---

## Background

### The Problem

When a user is removed via `/user remove` and then re-added:

1. `/user remove` deletes the user from papai's `users` table
2. But the user's Kaneo account still exists (Kaneo doesn't support user deletion by default)
3. On re-add, `provisionKaneoUser()` tries to sign up with the same deterministic email
4. Kaneo rejects this with "email already exists" error
5. Auto-provisioning fails, user must manually configure via `/setup`

### The Solution

Generate **unique email addresses** for each Kaneo registration:

- Old: `123456@pap.ai` → always the same, causes conflict
- New: `123456-a1b2c3d4@pap.ai` → unique per registration, no conflict

The suffix is a short random string (8 chars from UUID) that's stored with the user but not needed for login (user logs in via web UI with their password or magic link, not by email).

---

## Task 1: Modify Email and Slug Generation in Provision Function

**Files:**

- Modify: `src/providers/kaneo/provision.ts:110-140`
- Test: `tests/providers/kaneo/provision.test.ts` (new file)

**Step 1: Write the failing test**

Create `tests/providers/kaneo/provision.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockDrizzle, mockLogger, setMockFetch, restoreFetch, setupTestDb } from '../../utils/test-helpers.js'

// Setup mocks BEFORE importing code under test
mockLogger()
mockDrizzle()

let testDb: Awaited<ReturnType<typeof setupTestDb>>

// Mock config and workspace functions to avoid database writes
void mock.module('../../../../src/config.js', () => ({
  getConfig: () => null,
  setConfig: () => {},
}))

void mock.module('../../../../src/cache.js', () => ({
  getCachedWorkspace: () => null,
  setCachedWorkspace: () => {},
  clearCachedTools: () => {},
  _userCaches: new Map(),
}))

import { provisionAndConfigure } from '../../../../src/providers/kaneo/provision.js'

describe('provisionAndConfigure - unique email generation', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()

    // Track captured values per test
    const capturedEmails: string[] = []
    const capturedSlugs: string[] = []

    setMockFetch((url: string, init?: RequestInit) => {
      if (url.includes('/sign-up')) {
        // Capture the email from the request body
        const body = init?.body !== undefined ? JSON.parse(init.body as string) : {}
        capturedEmails.push(body.email)

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { getSetCookie: () => ['better-auth.session_token=abc123; Path=/; HttpOnly'] },
          json: async () => ({ user: { id: 'user-123' }, token: 'session-token' }),
        } as Response)
      }

      if (url.includes('/organization/create')) {
        // Capture the slug from the request body
        const body = init?.body !== undefined ? JSON.parse(init.body as string) : {}
        capturedSlugs.push(body.slug)

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 'ws-123', slug: body.slug }),
        } as Response)
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ key: 'api-key-123' }),
        } as Response)
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })
  })

  test('generates unique email with random suffix', async () => {
    const capturedEmails: string[] = []
    const capturedSlugs: string[] = []

    setMockFetch((url: string, init?: RequestInit) => {
      if (url.includes('/sign-up')) {
        const body = init?.body !== undefined ? JSON.parse(init.body as string) : {}
        capturedEmails.push(body.email)

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { getSetCookie: () => ['better-auth.session_token=abc123; Path=/; HttpOnly'] },
          json: async () => ({ user: { id: 'user-123' }, token: 'session-token' }),
        } as Response)
      }

      if (url.includes('/organization/create')) {
        const body = init?.body !== undefined ? JSON.parse(init.body as string) : {}
        capturedSlugs.push(body.slug)

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 'ws-123', slug: body.slug }),
        } as Response)
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ key: 'api-key-123' }),
        } as Response)
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })

    // Provision user twice with same ID
    await provisionAndConfigure('999', null)
    await provisionAndConfigure('999', null)

    // Should have captured two different emails
    expect(capturedEmails).toHaveLength(2)
    expect(capturedEmails[0]).not.toBe(capturedEmails[1])

    // Both should contain the user ID
    expect(capturedEmails[0]).toContain('999')
    expect(capturedEmails[1]).toContain('999')

    // Both should end with @pap.ai
    expect(capturedEmails[0]).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)
    expect(capturedEmails[1]).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)

    // Should have captured two different slugs
    expect(capturedSlugs).toHaveLength(2)
    expect(capturedSlugs[0]).not.toBe(capturedSlugs[1])
  })

  test('generates email with username when provided', async () => {
    let capturedEmail = ''

    setMockFetch((url: string, init?: RequestInit) => {
      if (url.includes('/sign-up')) {
        const body = init?.body !== undefined ? JSON.parse(init.body as string) : {}
        capturedEmail = body.email

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { getSetCookie: () => ['better-auth.session_token=abc123; Path=/; HttpOnly'] },
          json: async () => ({ user: { id: 'user-123' }, token: 'session-token' }),
        } as Response)
      }

      if (url.includes('/organization/create')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 'ws-123', slug: 'test-ws' }),
        } as Response)
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ key: 'api-key-123' }),
        } as Response)
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })

    await provisionAndConfigure('123', 'alice')

    expect(capturedEmail).toMatch(/alice-[a-z0-9]{8}@pap\.ai$/i)
  })

  test('successful provisioning returns workspace and credentials', async () => {
    setMockFetch((url: string) => {
      if (url.includes('/sign-up')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { getSetCookie: () => ['better-auth.session_token=abc123; Path=/; HttpOnly'] },
          json: async () => ({ user: { id: 'user-123' }, token: 'session-token' }),
        } as Response)
      }

      if (url.includes('/organization/create')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 'ws-abc', slug: 'papai-999' }),
        } as Response)
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ key: 'test-api-key' }),
        } as Response)
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })

    const result = await provisionAndConfigure('999', null)

    expect(result.status).toBe('provisioned')
    expect(result.workspaceId).toBe('ws-abc')
    expect(result.apiKey).toBe('test-api-key')
    expect(result.email).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)
  })

  test('returns registration_disabled for auth errors', async () => {
    setMockFetch(() => {
      return Promise.resolve({
        ok: false,
        status: 403,
        text: async () => 'Registration is disabled',
      } as Response)
    })

    const result = await provisionAndConfigure('999', null)

    expect(result.status).toBe('registration_disabled')
  })
})

afterAll(() => {
  restoreFetch()
  mock.restore()
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/kaneo/provision.test.ts`
Expected: FAIL - emails and slugs will be deterministic (same each time), test expects unique

**Step 3: Modify provision.ts to generate unique emails and slugs**

Modify `src/providers/kaneo/provision.ts:110-140` (the `provisionKaneoUser` function):

Replace lines 117-121:

```typescript
const email = username === null ? `${platformUserId}@pap.ai` : `${username}@pap.ai`
const password = generatePassword()
const name = username === null ? `User ${platformUserId}` : `@${username}`
const slug = `papai-${platformUserId}`
```

With:

```typescript
const uniqueSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
const email = username === null ? `${platformUserId}-${uniqueSuffix}@pap.ai` : `${username}-${uniqueSuffix}@pap.ai`
const password = generatePassword()
const name = username === null ? `User ${platformUserId}` : `@${username}`
const slug = `papai-${platformUserId}-${uniqueSuffix}`
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/kaneo/provision.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add tests/providers/kaneo/provision.test.ts src/providers/kaneo/provision.ts
git commit -m "feat(kaneo): generate unique email addresses and slugs per registration

- Add random 8-char suffix to pap.ai email addresses
- Add random 8-char suffix to workspace slugs
- Prevents 'email already exists' and slug conflicts on user re-add
- Same user can now be provisioned multiple times with unique accounts
- Updates existing tests and adds new test file"
```

---

## Task 2: Update Existing Admin Tests

**Files:**

- Modify: `tests/commands/admin.test.ts:144-169`

**Step 1: Update test to expect unique email format**

Modify `tests/commands/admin.test.ts` line 144-169:

Replace the `provision success replies with email, password, and URL` test:

```typescript
test('provision success replies with email, password, and URL', async () => {
  provisionImpl = (): Promise<ProvisionResult> =>
    Promise.resolve({
      status: 'provisioned',
      email: '12345-a1b2c3d4@pap.ai', // Updated to match unique format
      password: 'abc123',
      kaneoUrl: 'https://kaneo.test',
      apiKey: 'key',
      workspaceId: 'ws-1',
    })

  const handler = commandHandlers.get('user')
  expect(handler).toBeDefined()
  const { reply, getReplies } = createMockReply()
  await handler!(createDmMessage(ADMIN_ID, 'add 12345'), reply, {
    allowed: true,
    isBotAdmin: true,
    isGroupAdmin: false,
    storageContextId: ADMIN_ID,
  })
  const replies = getReplies()
  expect(replies.some((r) => r.includes('@pap.ai'))).toBe(true) // Check for email pattern
  expect(replies.some((r) => r.includes('abc123'))).toBe(true)
  expect(replies.some((r) => r.includes('kaneo.test'))).toBe(true)
  expect(isAuthorized('12345')).toBe(true)
})
```

**Step 2: Run test to verify it passes**

Run: `bun test tests/commands/admin.test.ts`
Expected: PASS (all existing tests)

**Step 3: Commit**

```bash
git add tests/commands/admin.test.ts
git commit -m "test(commands): update admin tests for unique email format

- Update provision success test to expect email with suffix pattern
- Use flexible assertion that checks for @pap.ai domain"
```

---

## Task 3: Run Full Test Suite and Verify

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 2: Run type checking**

Run: `bun typecheck`
Expected: No type errors

**Step 3: Run linting**

Run: `bun lint`
Expected: No lint errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: enable user re-add by generating unique Kaneo emails and slugs

Changes the email and slug generation from deterministic to unique per-registration:
- Old email: {userId}@pap.ai (same each time, causes conflicts)
- New email: {userId}-{random8chars}@pap.ai (unique, no conflicts)
- Old slug: papai-{userId} (same each time, causes conflicts)
- New slug: papai-{userId}-{random8chars} (unique, no conflicts)

This allows users to be removed and re-added multiple times, creating
fresh Kaneo accounts each time without 'email already exists' errors.

Breaking change: Re-adding a user creates a NEW Kaneo workspace, not
restoring the old one. This is the intended behavior since Kaneo doesn't
support user deletion.

Files changed:
- src/providers/kaneo/provision.ts: Unique email and slug generation
- tests/providers/kaneo/provision.test.ts: New test file
- tests/commands/admin.test.ts: Updated assertions"
```

---

## Verification Steps

To manually test the fix:

1. **Start papai with Kaneo provider:**

   ```bash
   TASK_PROVIDER=kaneo bun start
   ```

2. **Add a new user:**

   ```
   /user add 123456
   ```

   - Should show email like `123456-a1b2c3d4@pap.ai`
   - Note the workspace ID

3. **Remove the user:**

   ```
   /user remove 123456
   ```

4. **Re-add the same user:**

   ```
   /user add 123456
   ```

   - Should succeed without "email already exists" error
   - Should show NEW email like `123456-e5f6g7h8@pap.ai`
   - Should show NEW workspace ID

5. **Verify both workspaces exist in Kaneo:**
   - Log into Kaneo web UI
   - Both workspaces should be listed (old and new)

---

## Important Notes

### Data Isolation

Each re-add creates a **completely new** Kaneo workspace:

- Old tasks/projects remain in the old workspace
- New tasks go to the new workspace
- No automatic data migration between workspaces

This is intentional because:

1. Kaneo doesn't support user deletion
2. It's safer than trying to restore/merge workspaces
3. Users can manually migrate data if needed

### Workspace Cleanup

Old workspaces will accumulate over time. Consider:

- Periodic manual cleanup via Kaneo admin UI
- Archiving unused workspaces
- Documenting this behavior to users

---

## Edge Cases Handled

1. **Same user ID re-added multiple times** → Each gets unique email and slug, no conflicts
2. **User with username** → `alice-a1b2c3d4@pap.ai` format
3. **User without username** → `123456-a1b2c3d4@pap.ai` format
4. **Collision improbability** → 8 hex chars = 4.3 billion combinations, extremely unlikely

---

## Files Modified/Created Summary

| File                                      | Action | Purpose                                           |
| ----------------------------------------- | ------ | ------------------------------------------------- |
| `src/providers/kaneo/provision.ts`        | Modify | Generate unique email and slug with random suffix |
| `tests/providers/kaneo/provision.test.ts` | Create | Test unique email and slug generation             |
| `tests/commands/admin.test.ts`            | Modify | Update assertions for new email format            |
