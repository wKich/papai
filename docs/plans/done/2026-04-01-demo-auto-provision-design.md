# Demo Auto-Provisioning Design

## Goal

Enable demo mode where any new user who messages or `/start`s the bot is automatically added, Kaneo-provisioned, and pre-filled with the admin's LLM config — so they can use the bot immediately with zero setup.

## Approach

Intercept in the authorization check (`checkAuthorizationExtended` in `src/bot.ts`). When `DEMO_MODE=true` and an unknown DM user arrives, add them to the users table before the existing auth logic runs. The rest of the flow (Kaneo provisioning via `maybeProvisionKaneo`, LLM config via a new `copyAdminLlmConfig`) happens on the user's first message through the existing orchestrator path.

## Decisions

- **Source of LLM defaults**: Copy from admin user's config (not env vars)
- **Activation**: `DEMO_MODE=true` env var toggle. Off = current behavior unchanged
- **User flow**: Full auto — any message or `/start` from an unknown user triggers provisioning
- **Admin commands**: Remain restricted to the admin user
- **Kaneo registration**: Must be enabled in the demo environment (already the default in docker compose)

## Changes

### `.env.example`

Add `DEMO_MODE=false` with documentation comment.

### `src/config.ts`

New function `copyAdminLlmConfig(targetUserId)`:

- Reads `ADMIN_USER_ID` from env
- Copies `llm_apikey`, `llm_baseurl`, `main_model`, `small_model` from admin to target user
- Skips keys the admin hasn't set (no-op if admin has no config)

### `src/bot.ts` — `checkAuthorizationExtended()`

Add before the existing `isAuthorized` check:

```
if (DEMO_MODE && !isAuthorized(userId) && contextType === 'dm') {
  addUser(userId, 'demo-auto', username ?? undefined)
}
```

The user is now known. The subsequent `isAuthorized(userId)` returns `true`, and the function returns `getBotAdminAuth(...)` — same as any authorized DM user.

### `src/llm-orchestrator.ts` — `maybeProvisionKaneo()`

After successful `provisionAndConfigure()` (status `'provisioned'`), call `copyAdminLlmConfig(contextId)`. Also call it when Kaneo is already provisioned but LLM config is missing.

### No changes to

- `/start` command handler — demo users are already authorized by the time it runs
- Admin commands — remain admin-only
- Wizard flow — won't auto-trigger for demo users who have config
- Group message handling — demo auto-add only applies to DMs
- YouTrack provider — demo mode is Kaneo-specific

## Error handling

- **Provisioning failure**: User is added but has no workspace/config. On next message `maybeProvisionKaneo` retries. Existing error messages sent to user.
- **Admin has no LLM config**: `copyAdminLlmConfig` is a no-op. User gets Kaneo but no LLM. `checkRequiredConfig()` returns missing keys on first message. Admin must configure LLM first.
- **Double provisioning**: Not possible. `maybeProvisionKaneo` checks `getKaneoWorkspace()` and `getConfig('kaneo_apikey')` first and returns early.
- **Group messages**: Demo auto-add only triggers for DMs. Group behavior unchanged.
- **Username resolution**: `addUser(userId, 'demo-auto', username)` stores the username. `resolveUserByUsername()` still works.
