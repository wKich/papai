# Phase 05: Advanced Features — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-05-advanced-features.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Multiple team members can use the bot concurrently, each with their own isolated configuration and conversation context. An admin can grant or revoke access at runtime without restarting the server. Each user independently chooses which AI provider and model handles their requests — no deployment change required.
- **Success Metrics**:
  - Admin can add a user by numeric ID or `@username`; the bot confirms immediately and the new user can send messages without a restart
  - Admin can remove a user by identifier; subsequent messages from that user are silently dropped
  - Admin cannot be removed via `/user remove`
  - A user added by `@username` (before their first message) is resolved on first contact and can use the bot immediately
  - A user sets `llm_apikey`, `llm_baseurl`, and `main_model` via `/set`; subsequent requests use that model; other users' model settings are unaffected
  - An unauthorized user's message produces no task data in the reply and does not crash the bot
- **Priority**: High — enables team adoption beyond a single-user deployment
- **Timeline**: 1 day

---

## Current State Audit

### What is already in place

| Area                                                                         | Status                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------- | ----------- |
| `users` schema: `platform_user_id`, `username`, `added_at`, `added_by`       | ✅ Complete                                     |
| `addUser()` — inserts or upserts user record                                 | ✅ Complete                                     |
| `removeUser()` — deletes by `platform_user_id` or `username`                 | ✅ Complete                                     |
| `isAuthorized()` — checks presence in `users` table                          | ✅ Complete                                     |
| `resolveUserByUsername()` — replaces placeholder ID on first contact         | ✅ Complete                                     |
| `listUsers()` — returns all authorized users                                 | ✅ Complete                                     |
| `/user add <id                                                               | @username>`— admin command invoking`addUser`    | ✅ Complete |
| `/user remove <id                                                            | @username>`— admin command invoking`removeUser` | ✅ Complete |
| Admin self-remove guard in `handleUserRemove`                                | ✅ Complete                                     |
| Non-admin rejection in `registerAdminCommands`                               | ✅ Complete                                     |
| `/users` — lists all authorized users with timestamps                        | ✅ Complete                                     |
| `checkAuthorization()` in `bot.ts` — drops unauthorized messages             | ✅ Complete                                     |
| `setConfig()` / `getConfig()` per-user by `userId` key                       | ✅ Complete                                     |
| `/set <key> <value>` — command writing config per user                       | ✅ Complete                                     |
| `/config` — command displaying masked per-user config                        | ✅ Complete                                     |
| `user_config` schema scoped `(user_id, key)`                                 | ✅ Complete                                     |
| `llm_apikey`, `llm_baseurl`, `main_model`, `small_model` config keys         | ✅ Complete                                     |
| `checkRequiredConfig()` in `llm-orchestrator.ts` reading per-user LLM keys   | ✅ Complete                                     |
| Unit tests: `addUser`, `removeUser`, `isAuthorized`, `resolveUserByUsername` | ✅ Complete                                     |
| Unit tests: `setConfig`, `getConfig`, per-user isolation, `maskValue`        | ✅ Complete                                     |
| Auto-provisioning of Kaneo account on `/user add <id>`                       | ✅ Complete                                     |

### Confirmed gaps (mapped to user stories)

| Gap                                                                                                   | Story | File(s)                                 |
| ----------------------------------------------------------------------------------------------------- | ----- | --------------------------------------- |
| No tests for `/user add` command handler path (confirmation reply, non-admin rejection)               | 1     | `tests/commands/admin.test.ts` (new)    |
| No tests for `/user remove` command handler path (confirmation reply, admin self-remove guard)        | 2     | `tests/commands/admin.test.ts` (new)    |
| No tests for `/users` command handler path                                                            | 1, 2  | `tests/commands/admin.test.ts` (new)    |
| No tests for `checkAuthorization` bot gate — unauthorized message silently dropped                    | 6     | `tests/commands/bot-auth.test.ts` (new) |
| No tests for first-message username resolution through `checkAuthorization` → `resolveUserByUsername` | 3     | `tests/commands/bot-auth.test.ts` (new) |
| No tests for `/set` command handler path (valid key, invalid key, non-authorized user)                | 4     | `tests/commands/set.test.ts` (new)      |
| No tests for `/config` command handler path                                                           | 4, 5  | `tests/commands/config.test.ts` (new)   |

### User story status summary

| Story                                              | Status               | Work Required                                             |
| -------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| US1: Admin adds user by ID or username             | ⚠️ Gap               | Command-handler integration tests                         |
| US2: Admin removes user                            | ⚠️ Gap               | Command-handler integration tests (including admin guard) |
| US3: Newly authorized username user, first message | ⚠️ Gap               | Bot auth-gate integration tests                           |
| US4: User sets AI model via `/set`                 | ⚠️ Gap               | `/set` and `/config` command-handler integration tests    |
| US5: Per-user config isolation                     | ✅ Already satisfied | None — `config.test.ts` covers isolation                  |
| US6: Unauthorized user silently denied             | ⚠️ Gap               | Bot auth-gate test for silent drop path                   |

---

## Technical Architecture

### Authorization flow (existing, unchanged)

```
Incoming message
  └─ bot.ts: checkAuthorization(userId, username)
       ├─ isAuthorized(userId)                  → DB lookup users table
       │    └─ true  → proceed
       └─ resolveUserByUsername(userId, username)
            ├─ matches placeholder record        → update platform_user_id, return true → proceed
            └─ no match                          → return false → silent drop (no reply sent)
```

### Admin command flow (existing, unchanged)

```
/user add <identifier>
  └─ registerAdminCommands → checkAdmin(userId === adminUserId)
       ├─ not admin  → reply "Only the admin can manage users."
       └─ admin      → handleUserAdd
            ├─ parse identifier (numeric ID or @username)
            ├─ type=id   → addUser(id, adminId)  → reply "User <id> authorized."
            │                                     → provisionUserKaneo (async, best-effort)
            └─ type=username → addUser(placeholder-uuid, adminId, username)
                             → reply "User @<username> authorized."

/user remove <identifier>
  └─ handleUserRemove
       ├─ identifier === adminUserId → reply "Cannot remove the admin user."
       └─ otherwise                 → removeUser(identifier) → reply "User <identifier> removed."
```

### Per-user config flow (existing, unchanged)

```
/set <key> <value>
  └─ registerSetCommand → checkAuthorization(userId)
       ├─ not authorized → silent drop
       └─ authorized     → setConfig(userId, key, value) → reply "Set <key> successfully."

/config
  └─ registerConfigCommand → checkAuthorization(userId)
       ├─ not authorized → silent drop
       └─ authorized     → getAllConfig(userId) → format with maskValue → reply
```

### Test infrastructure (existing, established)

All command tests will use a lightweight mock `ChatProvider` following the pattern established in `tests/helpers/`. A mock `ReplyFn` captures arguments sent to `reply.text()` for assertions. The `users` table is populated via an in-memory DB with the migration set applied in `beforeEach`.

### No new libraries required

All required functionality is available via:

- `bun:test` (already used) — `describe`, `test`, `expect`, `mock`, `beforeEach`
- `bun:sqlite` (already used) — in-memory database for handler tests
- `drizzle-orm/bun-sqlite` (already used) — schema-consistent test DB
- `src/db/migrations/*` (already used in tests) — migration set for `beforeEach`

---

## Detailed Task Breakdown

### Story 1 / 2: `/user add`, `/user remove`, `/users` command handler tests

**Objective**: Add `tests/commands/admin.test.ts` covering the command-handler paths of `registerAdminCommands`. These tests target the reply messages, the admin guard, and the self-remove guard — not the underlying `addUser`/`removeUser` logic (already tested in `users.test.ts`).

#### Task 1.1 — Create `tests/commands/admin.test.ts`

- **File**: `tests/commands/admin.test.ts` (new)
- **Setup**: In-memory DB with full migration set applied via `runMigrations`. Mock `getDrizzleDb` to return the test DB. Mock `provisionAndConfigure` to resolve `{ status: 'skipped' }` (bypass Kaneo provisioning). Create a stub `ChatProvider` that captures registered command handlers and a stub `ReplyFn` that records `.text()` calls.
- **Test cases**:

  **`/user add` — admin adds by numeric ID**
  1. `adds user by numeric ID and confirms` — call handler with `{ commandMatch: 'add 123456' }` as admin; assert reply contains `"User 123456 authorized."` and `isAuthorized('123456')` returns `true`

  **`/user add` — admin adds by @username** 2. `adds user by @username and confirms` — call handler with `{ commandMatch: 'add @alice' }` as admin; assert reply contains `"User @alice authorized."` and `listUsers()` includes a record with `username: 'alice'`

  **`/user add` — non-admin is rejected** 3. `rejects non-admin caller` — call handler as non-admin user; assert reply is `"Only the admin can manage users."` and no user is added

  **`/user add` — missing identifier** 4. `shows usage when identifier is missing` — call handler with `{ commandMatch: 'add' }` as admin; assert reply includes `"Usage: /user add"`

  **`/user remove` — admin removes existing user** 5. `removes user by ID and confirms` — add user `'999'`; call handler with `{ commandMatch: 'remove 999' }` as admin; assert reply contains `"removed"` and `isAuthorized('999')` returns `false`

  **`/user remove` — admin removes by @username** 6. `removes user by @username and confirms` — add user with username `'bob'`; call handler with `{ commandMatch: 'remove @bob' }` as admin; assert reply contains `"removed"` and `listUsers()` contains no `username: 'bob'`

  **`/user remove` — admin self-remove guard** 7. `blocks admin from removing themselves` — call handler with `{ commandMatch: 'remove <adminId>' }` as admin; assert reply is `"Cannot remove the admin user."` and `isAuthorized(adminId)` remains `true`

  **`/user remove` — non-admin is rejected** 8. `rejects non-admin caller` — call handler as non-admin; assert reply is `"Only the admin can list users."` or `"Only the admin can manage users."`

  **`/users` — lists authorized users** 9. `lists all authorized users` — add two users; call `/users` handler as admin; assert reply contains both user IDs 10. `shows empty message when no users` — call `/users` on empty DB as admin; assert reply is `"No authorized users."`

  **`/users` — non-admin is rejected** 11. `rejects non-admin caller` — call `/users` as non-admin; assert reply is `"Only the admin can list users."`

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - All 11 tests pass with `bun test tests/commands/admin.test.ts`
  - No `@ts-ignore`, no `eslint-disable`
  - `provisionAndConfigure` is mocked (no real HTTP calls)
- **Dependencies**: None

---

### Story 3 / 6: Bot authorization gate tests

**Objective**: Add `tests/commands/bot-auth.test.ts` covering the `checkAuthorization` paths in `bot.ts`: silent drop of unauthorized messages, silent drop after removal, and username resolution on first contact.

#### Task 2.1 — Create `tests/commands/bot-auth.test.ts`

- **File**: `tests/commands/bot-auth.test.ts` (new)
- **Setup**: In-memory DB with migrations. Mock `getDrizzleDb`, `processMessage` (to a no-op stub — tests focus on the gate, not the LLM). Instantiate `setupBot` with a stub `ChatProvider` that captures the `onMessage` handler. Create a stub `ReplyFn` that records `.text()` and `.typing()` calls.
- **Test cases**:

  **Unauthorized user — silent drop**
  1. `does not call processMessage for unauthorized user` — call `onMessage` handler with user ID not in DB; assert `processMessage` was NOT called and `reply.text` was NOT called
  2. `does not call reply.typing for unauthorized user` — same setup; assert `reply.typing` was NOT called (no indication of activity)

  **Authorized user — message processed** 3. `calls processMessage for authorized user` — add user to DB; call `onMessage` handler; assert `processMessage` was called with the correct `userId`

  **Username resolution on first message (Story 3)** 4. `resolves username to real ID on first message` — add user as placeholder with `username: 'newuser'`; call `onMessage` with `{ id: 'real-555', username: 'newuser' }`; assert `processMessage` is called (authorization passes) and `isAuthorized('real-555')` returns `true` after the call 5. `subsequent messages from resolved user use real ID` — after resolution in prior test, call `onMessage` again with `{ id: 'real-555', username: 'newuser' }`; assert `processMessage` is called without needing username lookup

  **Access revoked during session** 6. `drops message after user is removed` — add user, call `onMessage` (assert processed), then `removeUser`, call `onMessage` again; assert second call does NOT invoke `processMessage`

- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - All 6 tests pass with `bun test tests/commands/bot-auth.test.ts`
  - `processMessage` is mocked — no LLM calls, no config dependencies
  - No `@ts-ignore`, no `eslint-disable`
- **Dependencies**: None

---

### Story 4: `/set` and `/config` command handler tests

**Objective**: Add `tests/commands/set.test.ts` and `tests/commands/config.test.ts` covering the command-handler paths for configuring per-user LLM settings. These tests verify that the commands accept valid keys, reject invalid keys, and gate on authorization — complementing the `config.test.ts` unit tests for the underlying logic.

#### Task 3.1 — Create `tests/commands/set.test.ts`

- **File**: `tests/commands/set.test.ts` (new)
- **Setup**: In-memory DB with migrations. Mock `getDrizzleDb`. Stub `ChatProvider` and `ReplyFn`.
- **Test cases**:

  **Valid key/value pair**
  1. `stores valid config key and confirms` — add authorized user; call `/set llm_apikey sk-test1234`; assert reply is `"Set llm_apikey successfully."` and `getConfig(userId, 'llm_apikey')` returns `'sk-test1234'`
  2. `stores main_model and confirms` — call `/set main_model gpt-4o`; assert reply and `getConfig` return correctly
  3. `stores llm_baseurl and confirms` — call `/set llm_baseurl https://api.openai.com/v1`; assert correctly stored

  **Invalid key** 4. `rejects unknown key` — call `/set invalid_key value`; assert reply contains `"Unknown key"` and lists valid keys; `getConfig(userId, 'invalid_key' as ConfigKey)` returns `null`

  **Missing value** 5. `shows usage when value is missing` — call `/set llm_apikey` (no value after key); assert reply contains `"Usage: /set"`

  **Unauthorized user** 6. `rejects unauthorized user silently` — call `/set main_model gpt-4` as non-authorized userId; assert reply NOT called (silent drop) and config NOT stored

- **Estimate**: 1h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - All 6 tests pass with `bun test tests/commands/set.test.ts`
  - No `@ts-ignore`, no `eslint-disable`
- **Dependencies**: None

#### Task 3.2 — Create `tests/commands/config.test.ts`

- **File**: `tests/commands/config.test.ts` (new)
- **Setup**: Same as Task 3.1.
- **Test cases**:

  **Displays current config**
  1. `shows all config keys with values and masked secrets` — add authorized user; set `llm_apikey` to `'sk-abc1234'`; call `/config`; assert reply contains `"llm_apikey: ****1234"` and contains `"main_model: (not set)"`
  2. `shows unset placeholder for unconfigured keys` — add authorized user with no config; call `/config`; assert reply contains `"(not set)"` for every key

  **Unauthorized user** 3. `rejects unauthorized user silently` — call `/config` as non-authorized userId; assert `reply.text` NOT called

- **Estimate**: 0.75h ±0.25h | **Priority**: Medium
- **Acceptance Criteria**:
  - All 3 tests pass with `bun test tests/commands/config.test.ts`
  - No `@ts-ignore`, no `eslint-disable`
- **Dependencies**: None

---

## Risk Assessment Matrix

| Risk                                                                                                          | Probability | Impact | Mitigation                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `provisionAndConfigure` makes real HTTP calls if not mocked in admin tests                                    | High        | High   | Mock `src/providers/kaneo/provision.js` in the test module setup block; pattern established in other provider tests                      |
| `processMessage` has transitive deps (LLM config, DB) that blow up when imported unmocked                     | Medium      | Medium | Mock `src/llm-orchestrator.js` entirely in bot-auth tests — only testing the gate logic, not the LLM path                                |
| Stub `ChatProvider` needs to capture `onMessage` handler reference for later invocation in tests              | Low         | Low    | Pattern: store handler reference inside stub, expose it as a field (`stub.messageHandler`)                                               |
| `checkAuthorization` is a closure inside `bot.ts` and not exported — tests must go through `setupBot`         | Low         | Low    | Tests instantiate `setupBot` with the stub provider and admin ID, then invoke captured handlers — no need to export `checkAuthorization` |
| Mock module order sensitivity in `bun:test` — mocks must be declared before the module-under-test is imported | Medium      | Medium | Follow established pattern from `config.test.ts` and `users.test.ts`: `mock.module(...)` calls before import statements                  |

---

## Resource Requirements

- **Total estimated development time**: ~5.25h (Tasks 1.1 + 2.1 + 3.1 + 3.2)
- **Skills required**: `bun:test` mock patterns, Drizzle in-memory DB setup (established by existing tests)
- **External dependencies**: None — no new packages, no real network calls
- **Testing requirements**: All new tests run within `bun test tests/commands/` and are included in the global `bun test` run; test count expected to grow from 637 to approximately 663 (+26 new tests)

---

## 📋 DISPLAY INSTRUCTIONS FOR OUTER AGENT

**Outer Agent: You MUST present this development plan using the following format:**

1. **Present the COMPLETE development roadmap** - Do not summarize or abbreviate sections
2. **Preserve ALL task breakdown structures** with checkboxes and formatting intact
3. **Show the full risk assessment matrix** with all columns and rows
4. **Display ALL planning templates exactly as generated** - Do not merge sections
5. **Maintain all markdown formatting** including tables, checklists, and code blocks
6. **Present the complete technical specification** without condensing
7. **Show ALL quality gates and validation checklists** in full detail

**Do NOT create an executive summary or overview - present the complete development plan exactly as generated with all detail intact.**
