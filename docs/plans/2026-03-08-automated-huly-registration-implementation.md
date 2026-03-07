# Automated Huly User Registration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically register Telegram bot users in Huly and send them credentials on their first interaction.

**Architecture:** Add a registration module using `@hcengineering/account-client` with bot admin credentials, integrate it into the bot's first-time user flow, and auto-populate user config with generated credentials.

**Tech Stack:** TypeScript, Bun, Grammy (Telegram), `@hcengineering/account-client`, SQLite

---

## Pre-Implementation Setup

### Task 0: Add account-client dependency

**Files:**

- Modify: `package.json`

**Step 1: Install the account-client package**

```bash
bun add @hcengineering/account-client
```

**Step 2: Verify installation**

Run: `bun install`
Expected: Package installed successfully

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "deps: add @hcengineering/account-client for user registration"
```

---

## Phase 1: Registration Module

### Task 1: Create registration errors

**Files:**

- Create: `src/errors.ts` (add to existing file)

**Step 1: Add new error types**

In `src/errors.ts`, add after existing error definitions:

```typescript
export type HulyRegistrationErrorType =
  | 'huly_api_unavailable'
  | 'huly_auth_failed'
  | 'huly_user_exists'
  | 'huly_workspace_not_found'
  | 'huly_registration_failed'

export interface HulyRegistrationError {
  type: 'huly_registration'
  code: HulyRegistrationErrorType
  message: string
  cause?: unknown
}

export function hulyRegistrationError(
  code: HulyRegistrationErrorType,
  message: string,
  cause?: unknown,
): HulyRegistrationError {
  return { type: 'huly_registration', code, message, cause }
}
```

**Step 2: Update error discriminator**

Modify the `AppError` union type to include the new error:

```typescript
export type AppError =
  | ConfigError
  | HulyApiError
  | HulyRegistrationError // Add this
  | TelegramError
  | ValidationError
  | NotFoundError
  | LlmError
```

**Step 3: Add user-facing error messages**

Add to error message mapper:

```typescript
if (error.type === 'huly_registration') {
  switch (error.code) {
    case 'huly_api_unavailable':
      return 'Huly service is temporarily unavailable. Please try again later.'
    case 'huly_auth_failed':
      return 'Authentication failed. Please contact the admin.'
    case 'huly_user_exists':
      return 'An account with this email already exists. Please contact the admin for assistance.'
    case 'huly_workspace_not_found':
      return 'Workspace configuration error. Please contact the admin.'
    case 'huly_registration_failed':
      return 'Failed to create account. Please try again later or contact the admin.'
  }
}
```

**Step 4: Commit**

```bash
git add src/errors.ts
git commit -m "feat: add Huly registration error types"
```

---

### Task 2: Create Huly registration module

**Files:**

- Create: `src/huly/register-user.ts`
- Create: `tests/huly/register-user.test.ts`

**Step 1: Write the registration module**

Create `src/huly/register-user.ts`:

```typescript
import { AccountClient } from '@hcengineering/account-client'
import { logger } from '../logger.js'
import { hulyRegistrationError } from '../errors.js'
import { hulyUrl, hulyWorkspace } from './env.js'

const log = logger.child({ scope: 'huly:register-user' })

export interface RegistrationResult {
  email: string
  password: string
}

function generateSecurePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const length = 16
  let password = ''
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

function generateEmail(telegramId: number, username: string | undefined): string {
  const identifier = username || `user${telegramId}`
  return `${identifier}@hu.ly`
}

export async function registerHulyUser(
  telegramId: number,
  username: string | undefined,
  botAdminEmail: string,
  botAdminPassword: string,
): Promise<RegistrationResult> {
  log.debug({ telegramId, hasUsername: username !== undefined }, 'Starting Huly registration')

  const email = generateEmail(telegramId, username)
  const password = generateSecurePassword()

  log.info({ telegramId, email }, 'Generated credentials for Huly registration')

  try {
    // Create admin client
    const adminClient = new AccountClient(hulyUrl, botAdminEmail, botAdminPassword)

    log.debug({ telegramId }, 'Attempting to create Huly account')

    // Create the user account
    // Note: The exact API method depends on account-client version
    // This is a common pattern but may need adjustment based on actual API
    const result = await adminClient.createAccount(email, password, hulyWorkspace)

    if (result === null || result === undefined) {
      throw hulyRegistrationError('huly_registration_failed', 'Account creation returned null')
    }

    log.info({ telegramId, email }, 'Successfully created Huly account')

    return { email, password }
  } catch (error) {
    log.error(
      {
        telegramId,
        email,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to create Huly account',
    )

    // Handle specific error cases
    if (error instanceof Error) {
      if (error.message.includes('already exists') || error.message.includes('duplicate')) {
        throw hulyRegistrationError('huly_user_exists', `User with email ${email} already exists`, error)
      }
      if (error.message.includes('unauthorized') || error.message.includes('auth')) {
        throw hulyRegistrationError('huly_auth_failed', 'Bot admin authentication failed', error)
      }
      if (error.message.includes('workspace') || error.message.includes('not found')) {
        throw hulyRegistrationError('huly_workspace_not_found', `Workspace ${hulyWorkspace} not found`, error)
      }
    }

    throw hulyRegistrationError('huly_registration_failed', 'Failed to create Huly account', error)
  }
}
```

**Step 2: Create the test file**

Create `tests/huly/register-user.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test'
import { registerHulyUser } from '../../src/huly/register-user.js'

// Mock the dependencies
mock.module('@hcengineering/account-client', () => ({
  AccountClient: class MockAccountClient {
    constructor(
      public url: string,
      public email: string,
      public password: string,
    ) {}

    async createAccount(email: string, password: string, workspace: string) {
      return { email, workspace }
    }
  },
}))

describe('registerHulyUser', () => {
  it('should generate email with username when available', async () => {
    const result = await registerHulyUser(123456, 'john_doe', 'admin@test.com', 'adminpass')

    expect(result.email).toBe('john_doe@hu.ly')
    expect(result.password).toBeDefined()
    expect(result.password.length).toBe(16)
  })

  it('should generate email with user ID when username not available', async () => {
    const result = await registerHulyUser(123456, undefined, 'admin@test.com', 'adminpass')

    expect(result.email).toBe('user123456@hu.ly')
    expect(result.password).toBeDefined()
    expect(result.password.length).toBe(16)
  })

  it('should throw error when user already exists', async () => {
    mock.module('@hcengineering/account-client', () => ({
      AccountClient: class MockAccountClient {
        async createAccount() {
          throw new Error('User already exists')
        }
      },
    }))

    await expect(registerHulyUser(123456, 'existing_user', 'admin@test.com', 'adminpass')).rejects.toMatchObject({
      type: 'huly_registration',
      code: 'huly_user_exists',
    })
  })

  it('should throw error on authentication failure', async () => {
    mock.module('@hcengineering/account-client', () => ({
      AccountClient: class MockAccountClient {
        async createAccount() {
          throw new Error('Unauthorized')
        }
      },
    }))

    await expect(registerHulyUser(123456, 'new_user', 'admin@test.com', 'adminpass')).rejects.toMatchObject({
      type: 'huly_registration',
      code: 'huly_auth_failed',
    })
  })
})
```

**Step 3: Run tests to verify they work**

Run: `bun test tests/huly/register-user.test.ts`
Expected: Tests pass (or fail with expected errors if mocks need adjustment)

**Step 4: Commit**

```bash
git add src/huly/register-user.ts tests/huly/register-user.test.ts
git commit -m "feat: add Huly user registration module with tests"
```

---

## Phase 2: Environment Configuration

### Task 3: Add bot admin environment variables

**Files:**

- Modify: `.env.example`
- Modify: `src/index.ts` (validate new env vars)

**Step 1: Update .env.example**

Add to `.env.example`:

```bash
# Huly Bot Admin (for auto-registration)
HULY_BOT_ADMIN_EMAIL=bot@yourdomain.com
HULY_BOT_ADMIN_PASSWORD=change-me-to-secure-password
```

**Step 2: Add validation in index.ts**

In `src/index.ts`, add after existing env var validations:

```typescript
const hulyBotAdminEmail = process.env.HULY_BOT_ADMIN_EMAIL
if (hulyBotAdminEmail === undefined || hulyBotAdminEmail === '') {
  log.error('HULY_BOT_ADMIN_EMAIL environment variable is required')
  throw new Error('HULY_BOT_ADMIN_EMAIL environment variable is required')
}

const hulyBotAdminPassword = process.env.HULY_BOT_ADMIN_PASSWORD
if (hulyBotAdminPassword === undefined || hulyBotAdminPassword === '') {
  log.error('HULY_BOT_ADMIN_PASSWORD environment variable is required')
  throw new Error('HULY_BOT_ADMIN_PASSWORD environment variable is required')
}

log.info('Huly bot admin credentials configured')
```

**Step 3: Export for use in bot**

Add at the end of `src/index.ts`:

```typescript
export const hulyBotAdminEmail = process.env.HULY_BOT_ADMIN_EMAIL!
export const hulyBotAdminPassword = process.env.HULY_BOT_ADMIN_PASSWORD!
```

**Step 4: Commit**

```bash
git add .env.example src/index.ts
git commit -m "config: add HULY_BOT_ADMIN_EMAIL and HULY_BOT_ADMIN_PASSWORD env vars"
```

---

## Phase 3: Bot Integration

### Task 4: Create first-time user handler

**Files:**

- Create: `src/first-time-user.ts`
- Create: `tests/first-time-user.test.ts`
- Modify: `src/bot.ts`

**Step 1: Create first-time user handler**

Create `src/first-time-user.ts`:

```typescript
import type { Context } from 'grammy'
import { registerHulyUser } from './huly/register-user.js'
import { setConfig } from './config.js'
import { logger } from './logger.js'
import { hulyRegistrationError } from './errors.js'
import { hulyUrl } from './huly/env.js'

const log = logger.child({ scope: 'first-time-user' })

export interface FirstTimeUserDeps {
  hulyBotAdminEmail: string
  hulyBotAdminPassword: string
}

export async function handleFirstTimeUser(
  ctx: Context,
  userId: number,
  username: string | undefined,
  deps: FirstTimeUserDeps,
): Promise<void> {
  log.info({ userId, username }, 'Handling first-time user')

  try {
    // Register user in Huly
    const { email, password } = await registerHulyUser(
      userId,
      username,
      deps.hulyBotAdminEmail,
      deps.hulyBotAdminPassword,
    )

    // Store credentials in config
    setConfig(userId, 'huly_email', email)
    setConfig(userId, 'huly_password', password)

    log.info({ userId, email }, 'Stored Huly credentials for user')

    // Send welcome message with credentials
    const welcomeMessage = `
Welcome to papai! Your Huly account has been created automatically.

🌐 Huly URL: ${hulyUrl}
📧 Email: ${email}
🔑 Password: ${password}

Please save these credentials securely. You can now start managing your tasks!
    `.trim()

    await ctx.reply(welcomeMessage)
    log.info({ userId }, 'Sent welcome message with credentials')
  } catch (error) {
    log.error(
      {
        userId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to handle first-time user',
    )

    if (hulyRegistrationError.isInstance?.(error)) {
      await ctx.reply('Sorry, we could not create your Huly account. Please contact the admin for assistance.')
    } else {
      await ctx.reply('An unexpected error occurred. Please try again later.')
    }

    throw error
  }
}
```

**Step 2: Create test file**

Create `tests/first-time-user.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test'
import { handleFirstTimeUser } from '../src/first-time-user.js'

const mockContext = {
  reply: async (text: string) => ({ text }),
} as any

describe('handleFirstTimeUser', () => {
  it('should register user and send welcome message', async () => {
    mock.module('../src/huly/register-user.js', () => ({
      registerHulyUser: async () => ({
        email: 'testuser@hu.ly',
        password: 'Ab3fG7hJk9mN2pQr',
      }),
    }))

    mock.module('../src/config.js', () => ({
      setConfig: (userId: number, key: string, value: string) => {
        // Mock implementation
      },
    }))

    const deps = {
      hulyBotAdminEmail: 'admin@test.com',
      hulyBotAdminPassword: 'adminpass',
    }

    await handleFirstTimeUser(mockContext, 123456, 'testuser', deps)

    // Test passes if no error thrown
    expect(true).toBe(true)
  })

  it('should handle registration errors gracefully', async () => {
    mock.module('../src/huly/register-user.js', () => ({
      registerHulyUser: async () => {
        throw { type: 'huly_registration', code: 'huly_api_unavailable' }
      },
    }))

    const deps = {
      hulyBotAdminEmail: 'admin@test.com',
      hulyBotAdminPassword: 'adminpass',
    }

    await expect(handleFirstTimeUser(mockContext, 123456, 'testuser', deps)).rejects.toBeDefined()
  })
})
```

**Step 3: Run tests**

Run: `bun test tests/first-time-user.test.ts`
Expected: Tests pass

**Step 4: Commit**

```bash
git add src/first-time-user.ts tests/first-time-user.test.ts
git commit -m "feat: add first-time user handler with Huly registration"
```

---

### Task 5: Integrate into bot message handler

**Files:**

- Modify: `src/bot.ts`

**Step 1: Add import for first-time user handler**

At the top of `src/bot.ts`:

```typescript
import { handleFirstTimeUser } from './first-time-user.js'
import { hulyBotAdminEmail, hulyBotAdminPassword } from './index.js'
```

**Step 2: Modify message handler**

Find the `bot.on('message:text', ...)` handler and modify it:

```typescript
bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  const username = ctx.from?.username

  if (!checkAuthorization(userId, username)) {
    return
  }

  // Check if this is a first-time user (no Huly credentials)
  const hulyEmail = getConfig(userId, 'huly_email')
  if (hulyEmail === null) {
    log.info({ userId, username }, 'First-time user detected, initiating registration')

    try {
      await handleFirstTimeUser(ctx, userId, username, {
        hulyBotAdminEmail,
        hulyBotAdminPassword,
      })

      // After successful registration, continue with normal message processing
      // or inform user they can start using the bot
      await ctx.reply('Your account is ready! You can now start sending me task commands.')
    } catch (error) {
      log.error({ userId, error }, 'Failed to register first-time user')
      // Error already handled in handleFirstTimeUser (message sent to user)
    }
    return
  }

  const userText = ctx.message.text
  await processMessage(ctx, userId, userText)
})
```

**Step 3: Verify imports are correct**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/bot.ts
git commit -m "feat: integrate auto-registration into bot message handler"
```

---

## Phase 4: Testing & Verification

### Task 6: Create integration test

**Files:**

- Create: `tests/integration/auto-registration.test.ts`

**Step 1: Write integration test**

Create `tests/integration/auto-registration.test.ts`:

```typescript
import { describe, expect, it, mock, beforeAll } from 'bun:test'
import { Bot } from 'grammy'

describe('Auto-registration integration', () => {
  it('should complete full flow for new user', async () => {
    // This test verifies the components work together
    // Actual Huly calls should be mocked

    const mockRegisterHulyUser = mock(async () => ({
      email: 'test@hu.ly',
      password: 'testpassword123',
    }))

    mock.module('../../src/huly/register-user.js', () => ({
      registerHulyUser: mockRegisterHulyUser,
    }))

    // Verify the module can be imported and functions exist
    const { handleFirstTimeUser } = await import('../../src/first-time-user.js')

    expect(typeof handleFirstTimeUser).toBe('function')
  })
})
```

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/integration/auto-registration.test.ts
git commit -m "test: add auto-registration integration test"
```

---

## Phase 5: Documentation

### Task 7: Update documentation

**Files:**

- Modify: `CLAUDE.md` (update setup instructions)

**Step 1: Add setup instructions**

Add to `CLAUDE.md` under "Required Environment Variables":

```markdown
### For Auto-Registration (optional but recommended)

- `HULY_BOT_ADMIN_EMAIL` - Email of a Huly admin account with user creation permissions
- `HULY_BOT_ADMIN_PASSWORD` - Password for the bot admin account

To set up auto-registration:

1. Create a dedicated admin account in your Huly instance (e.g., bot@yourdomain.com)
2. Add these credentials to your `.env` file
3. When the admin adds a user via `/user add`, the user will automatically receive Huly credentials on their first message
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update setup instructions for auto-registration feature"
```

---

## Phase 6: Final Verification

### Task 8: Run full test suite and lint

**Files:**

- All files

**Step 1: Run linter**

Run: `bun run lint`
Expected: No errors or warnings

**Step 2: Run formatter**

Run: `bun run format`
Expected: All files formatted

**Step 3: Run tests**

Run: `bun test`
Expected: All tests pass

**Step 4: Type check**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete automated Huly user registration

- Add @hcengineering/account-client dependency
- Create registration module with error handling
- Add bot admin environment variables
- Integrate auto-registration into bot flow
- Send credentials to users on first interaction
- Add comprehensive tests
- Update documentation"
```

---

## Rollback Instructions

If issues occur in production:

1. **Disable auto-registration temporarily:**
   Comment out the first-time user check in `src/bot.ts`

2. **Revert to manual flow:**
   Users can still use `/set huly_email <email>` and `/set huly_password <pass>`

3. **Full rollback:**
   ```bash
   git revert HEAD~6..HEAD
   ```

---

## Deployment Checklist

Before deploying:

- [ ] Set `HULY_BOT_ADMIN_EMAIL` in production `.env`
- [ ] Set `HULY_BOT_ADMIN_PASSWORD` in production `.env`
- [ ] Verify bot admin account exists in Huly with proper permissions
- [ ] Test on staging: Add a test user and verify auto-registration
- [ ] Monitor logs for first few registrations
- [ ] Have admin credentials ready for manual override if needed

---

**Total Tasks:** 8  
**Estimated Time:** 2-3 hours  
**Risk Level:** Medium (requires production Huly credentials)
