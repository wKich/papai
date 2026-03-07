# Automated Huly User Registration Design

**Date:** 2026-03-08  
**Status:** Approved  
**Author:** Claude Code

## Overview

Automate Huly account creation for Telegram bot users to eliminate manual onboarding. When a user is added by the admin and interacts with the bot for the first time, they are automatically registered in Huly with auto-generated credentials sent via Telegram.

## Problem Statement

Currently, when an admin adds a new user via `/user add`, the user must manually:

1. Register for a Huly account
2. Configure their Huly credentials in the bot via `/set`

Since the self-hosted Huly instance has no mail server, email verification complicates registration. This creates friction in the onboarding process.

## Solution

Automate the registration flow:

1. Admin adds user to bot via `/user add <username>`
2. User messages the bot for the first time
3. Bot detects missing Huly credentials
4. Bot creates Huly account using admin API
5. Credentials are stored and sent to the user
6. User can immediately start using Huly features

## Architecture

### Components

#### 1. Environment Variables

Add to `.env`:

```bash
HULY_BOT_ADMIN_EMAIL=bot@yourdomain.com      # Dedicated bot admin account
HULY_BOT_ADMIN_PASSWORD=secure-password      # Bot admin password
```

#### 2. Registration Module: `src/huly/register-user.ts`

**Purpose:** Create Huly accounts programmatically

**Dependencies:**

- `@hcengineering/account-client` (already in dependency tree via `@hcengineering/api-client`)

**Interface:**

```typescript
export async function registerHulyUser(
  telegramId: number,
  username: string | undefined,
): Promise<{ email: string; password: string }>
```

**Implementation Details:**

- Connect to Huly using bot admin credentials
- Generate email: `${username || 'user' + telegramId}@hu.ly`
- Generate password: 16-character secure random string (a-z, A-Z, 0-9)
- Call account API to create user
- Add user to workspace
- Return credentials

**Error Handling:**

- `HulyRegistrationError` - Failed to connect to Huly
- `UserAlreadyExistsError` - User email already exists (attempt recovery)
- `WorkspaceNotFoundError` - Invalid workspace configuration

#### 3. Bot Integration: `src/bot.ts`

**Changes to message handler:**

```typescript
bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) {
    return
  }

  // Check if user needs Huly registration
  const hulyEmail = getConfig(userId, 'huly_email')
  if (hulyEmail === null) {
    await handleFirstTimeUser(ctx, userId, ctx.from?.username)
    return
  }

  const userText = ctx.message.text
  await processMessage(ctx, userId, userText)
})
```

**New function: `handleFirstTimeUser`**

- Register user in Huly via `registerHulyUser()`
- Store credentials: `setConfig(userId, 'huly_email', email)` and `setConfig(userId, 'huly_password', password)`
- Send welcome message with credentials and Huly URL
- Log registration event

**Welcome Message Format:**

```
Welcome to papai! Your Huly account has been created automatically.

🌐 Huly URL: https://huly.yourdomain.com
📧 Email: username@hu.ly
🔑 Password: Ab3fG7hJk9mN2pQr

Please save these credentials securely. You can now start managing your tasks!
```

#### 4. Config Updates: `src/config.ts`

No changes needed. Existing `huly_email` and `huly_password` config keys will be auto-populated.

## Data Flow

```
┌─────────────┐     /user add @john      ┌──────────────┐
│    Admin    │ ───────────────────────> │  admin-      │
│             │                          │  commands.ts │
└─────────────┘                          └──────────────┘
                                                │
                                                │ Add placeholder
                                                │ to users table
                                                ▼
┌─────────────┐     First message          ┌──────────────┐
│    User     │ ───────────────────────>   │     bot.ts   │
│   (@john)   │                            └──────────────┘
└─────────────┘                                   │
                                                  │ Check auth
                                                  │ Check config
                                                  ▼
                                          ┌──────────────┐
                                          │ No Huly creds│
                                          └──────────────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │ register-    │
                                          │ user.ts      │
                                          └──────────────┘
                                                  │
                                                  │ Bot admin API call
                                                  ▼
                                          ┌──────────────┐
                                          │     Huly     │
                                          │   Account    │
                                          │    API       │
                                          └──────────────┘
                                                  │
                                                  │ Account created
                                                  ▼
                                          ┌──────────────┐
                                          │  Store creds │
                                          │  in SQLite   │
                                          └──────────────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │ Send welcome │
                                          │  with creds  │
                                          └──────────────┘
                                                  │
                                                  ▼
┌─────────────┐     Welcome message        ┌──────────────┐
│    User     │ <────────────────────────  │    User      │
│   (@john)   │    with credentials        │  receives    │
└─────────────┘                            └──────────────┘
```

## Error Handling

### Registration Failures

| Error                   | Action                  | User Message                                                |
| ----------------------- | ----------------------- | ----------------------------------------------------------- |
| Huly API unavailable    | Log error, notify admin | "Service temporarily unavailable. Admin has been notified." |
| User already exists     | Attempt password reset  | "Account exists. Check your Telegram for new credentials."  |
| Invalid bot admin creds | Log critical error      | "Configuration error. Contact admin."                       |
| Workspace not found     | Log configuration error | "Configuration error. Contact admin."                       |

### Recovery Strategies

**User Already Exists:**

1. Check if email exists in Huly
2. If yes and in our DB: return existing credentials
3. If yes but not in our DB: generate new password, update Huly, store and send

**Network Failures:**

- Retry with exponential backoff (3 attempts)
- If all fail, store registration intent and retry on next message

## Security Considerations

1. **Bot Admin Credentials:**
   - Stored only in environment variables
   - Never logged or persisted to database
   - Should have minimal permissions (only user creation)

2. **User Passwords:**
   - Auto-generated with high entropy (16 chars, mixed case, digits)
   - Stored in SQLite (already encrypted at rest by OS)
   - Transmitted via Telegram's MTProto encryption

3. **Email Domain:**
   - Using `@hu.ly` prevents conflicts with real email addresses
   - Clearly identifies auto-generated accounts
   - Non-routable domain (no accidental email leaks)

4. **Audit Trail:**
   - Log all registration attempts with timestamp
   - Log admin who authorized the user
   - Log Huly API responses for debugging

## Testing Strategy

### Unit Tests

**register-user.ts:**

- Mock `@hcengineering/account-client`
- Test successful registration
- Test user already exists scenario
- Test API failure scenarios
- Test email generation with/without username

**bot.ts integration:**

- Mock first-time user flow
- Verify credentials are stored correctly
- Verify welcome message format

### Integration Tests

- Test against actual Huly instance (dev environment)
- Verify end-to-end flow
- Test error recovery

## Monitoring

### Metrics to Track

- Registration success rate
- Average registration time
- Error types and frequency
- Users pending registration (added but not yet messaged)

### Alerts

- High registration failure rate (>10% in 1 hour)
- Bot admin authentication failures
- Huly API unavailability

## Future Enhancements

1. **Password Reset:** Allow users to request new auto-generated password
2. **Username Conflicts:** Handle case when Telegram username already taken in Huly
3. **Multi-workspace:** Support adding users to multiple Huly workspaces
4. **Email Notifications:** If mail server is added later, send welcome emails

## Rollback Plan

If issues arise:

1. Set environment variable: `AUTO_REGISTRATION_ENABLED=false`
2. Bot will skip auto-registration and use existing manual flow
3. Users already registered keep their credentials
4. Can be re-enabled once issues resolved

## Dependencies

**Runtime:**

- `@hcengineering/account-client` (add to package.json)
- Existing: `@hcengineering/api-client`, `grammy`, `bun`

**No additional services required.**

## Success Criteria

1. New users receive Huly credentials on first bot interaction
2. Zero manual configuration required for new users
3. Registration completes in < 3 seconds
4. > 99% success rate for registrations
5. No security incidents related to credential handling

---

**Approved by:** User  
**Implementation Plan:** To be created via `writing-plans` skill
