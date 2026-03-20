# Feature: Group Chat Support

## Epic Overview

- **Business Value**: Enables teams to share a single bot instance within Telegram groups and Mattermost channels, with shared AI context, team-managed membership, and isolated per-group configuration.
- **Success Metrics**: All 16 acceptance criteria in `docs/user-stories/group-chat-support.md` pass in both automated tests and manual smoke tests on Telegram and Mattermost.
- **Priority**: High

---

## Technical Architecture

### Current State

| Concern             | Current Behaviour                                          |
| ------------------- | ---------------------------------------------------------- |
| Storage key         | Always `userId` (one context per user)                     |
| Auth                | `isAuthorized(userId)` — single DM-only list               |
| `IncomingMessage`   | No `contextType`, `contextId`, `isMentioned`, or `isAdmin` |
| `CommandHandler`    | `(msg, reply) => Promise<void>` — no auth result passed in |
| Telegram provider   | `onMessage` fires for every private text event             |
| Mattermost provider | No channel-type detection; all events treated as DM        |
| Commands            | `/user`, `/users` have no group restriction                |

### Target State

| Concern             | Target Behaviour                                                  |
| ------------------- | ----------------------------------------------------------------- |
| Storage key         | `contextId` — `userId` in DMs, `groupId` in groups                |
| Auth                | Two-tier: bot users (DM) + group members (per-group)              |
| `IncomingMessage`   | Carries `contextType`, `contextId`, `isMentioned`, `user.isAdmin` |
| `CommandHandler`    | `(msg, reply, auth) => Promise<void>`                             |
| Telegram provider   | Group detection via `chat.type`; mention via entities             |
| Mattermost provider | Channel-type detection via `/api/v4/channels/{id}`                |
| Commands            | `/group` only in groups; `/user`/`/users` only in DMs             |

### Component Relationships

```
IncomingMessage (extended)
    │
    ├─ contextType: 'dm' | 'group'
    ├─ contextId: string          ← storage key
    ├─ isMentioned: boolean
    └─ user.isAdmin: boolean
             │
             ▼
    checkAuthorizationExtended()
             │
             ▼
    AuthorizationResult
    ├─ allowed: boolean
    ├─ isBotAdmin: boolean
    ├─ isGroupAdmin: boolean
    └─ storageContextId: string   ← passed to all storage
             │
         ┌───┴──────────────────────────────────┐
         ▼                                      ▼
    CommandHandler(msg, reply, auth)    onMessage handler
    (uses auth.storageContextId)        (mention guard for groups)
```

### Data Flow: Group Natural Language Query

```
User @bot <question>
  → Telegram/Mattermost provider
  → extractMessage() → IncomingMessage { contextType:'group', isMentioned:true }
  → checkAuthorizationExtended() → AuthorizationResult
  → if !auth.allowed && isMentioned → reply "not authorized..."
  → if !isMentioned in group → silent ignore
  → if allowed → processMessage(reply, groupId, username, text)
  → loadHistory(groupId) → shared context
```

### Database Schema Addition

```sql
CREATE TABLE group_members (
  group_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  added_by  TEXT NOT NULL,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user  ON group_members(user_id);
```

### Technology Stack

| Layer      | Technology                  | Notes                            |
| ---------- | --------------------------- | -------------------------------- |
| Runtime    | Bun                         | No change                        |
| Language   | TypeScript 5.x              | No change                        |
| ORM        | Drizzle ORM (bun-sqlite)    | Add new table, new migration     |
| Telegram   | grammy ^1.x                 | `getChatAdministrators`, `getMe` |
| Mattermost | WebSocket + fetch `/api/v4` | Channel + member API calls       |
| Validation | Zod ^3.x                    | New schemas for channel/user     |
| Testing    | `bun:test`                  | All new tests use in-memory DB   |

---

## Library & Framework Research

### grammy (Telegram) — existing dependency

- **Purpose**: Telegram Bot API; group detection and admin lookup already supported
- **Relevant APIs**: `bot.api.getMe()`, `bot.api.getChatAdministrators(chatId)`, `ctx.chat?.type`, `ctx.message?.entities`
- **Status**: Actively maintained (2024-2025) ✅
- **No new dependency needed**

### Mattermost REST API — no new dependency

- **Relevant endpoints**:
  - `GET /api/v4/channels/{channel_id}` — returns `type` field; `'D'` = direct
  - `GET /api/v4/channels/{channel_id}/members/{user_id}` — returns `roles`
- **Admin detection**: `roles.includes('channel_admin')` or system-level admin
- **No new dependency needed**

### Drizzle ORM — existing dependency

- **Pattern used in project**: `db.insert(...).onConflictDoNothing()`, `db.delete(...).where(and(...))` — same patterns apply
- **Migration pattern**: numbered `.ts` files in `src/db/migrations/`; next is `008_`

---

## User Story → Task Mapping

| User Story | Key Tasks                                                             |
| ---------- | --------------------------------------------------------------------- |
| US 1       | Task 4, 5 (provider detection); Task 3 (auth); Task 6 (mention guard) |
| US 2       | Task 3 (rejection reply on mention); Task 6 (message guard)           |
| US 3       | Task 1 (schema); Task 2 (groups module); Task 7 (group commands)      |
| US 4       | Task 1 (schema); Task 2 (groups module); Task 7 (group commands)      |
| US 5       | Task 2 (groups module); Task 7 (group commands)                       |
| US 6       | Task 8 (contextId as storage key throughout)                          |
| US 7       | Task 9 (clear command group restrictions)                             |
| US 8       | Task 9 (set/config group restrictions)                                |
| US 9       | Task 8 (contextId isolation by group)                                 |
| US 10      | Task 7 (group command rejects in DM context)                          |
| US 11      | Task 9 (user/users command rejects in group context)                  |
| US 12      | Task 6 (mention guard in message handler)                             |
| US 13      | Task 6 (commands bypass mention requirement)                          |
| US 14      | Task 2 (immediate DB delete); Task 3 (auth checks on every message)   |
| US 15      | Task 10 (help command group-aware text)                               |
| US 16      | Task 3 (bot admin bypasses group membership check)                    |

---

## Detailed Task Breakdown

### Task 1: Database Schema — `group_members` Table

**Estimate**: 2h ±0.5h | **Assignee**: Backend | **Priority**: High  
**Blocks**: Tasks 2, 7  
**Acceptance Criteria**:

- [ ] `src/db/schema.ts` exports `groupMembers` table with correct columns and indexes
- [ ] `src/db/migrations/008_group_members.ts` runs without error on fresh DB
- [ ] `bun typecheck` passes

**Files**:

- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/008_group_members.ts`

**Schema addition** (`src/db/schema.ts`):

```typescript
export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    addedBy: text('added_by').notNull(),
    addedAt: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('idx_group_members_group').on(table.groupId),
    index('idx_group_members_user').on(table.userId),
  ],
)

export type GroupMember = typeof groupMembers.$inferSelect
```

**Migration** (`src/db/migrations/008_group_members.ts`):
Follow the existing migration file pattern in the project. Execute SQL to create the table and its indexes.

---

### Task 2: Groups Module (`src/groups.ts`)

**Estimate**: 3h ±1h | **Assignee**: Backend | **Priority**: High  
**Depends on**: Task 1  
**Acceptance Criteria**:

- [ ] `addGroupMember(groupId, userId, addedBy)` inserts; duplicate insert is a no-op
- [ ] `removeGroupMember(groupId, userId)` deletes the row
- [ ] `isGroupMember(groupId, userId)` returns `true`/`false` correctly
- [ ] `listGroupMembers(groupId)` returns rows with `user_id`, `added_by`, `added_at`, newest-first
- [ ] All four functions covered by unit tests using in-memory DB (pattern from `tests/users.test.ts`)
- [ ] `bun test tests/groups.test.ts` passes

**Files**:

- Create: `src/groups.ts`
- Create: `tests/groups.test.ts`

**Test table setup** (tests should inline `CREATE TABLE group_members ...` using same in-memory DB mock pattern as `tests/users.test.ts`).

---

### Task 3: Type System Extension (`src/chat/types.ts`)

**Estimate**: 1h ±0.5h | **Assignee**: Frontend/Backend | **Priority**: High  
**Blocks**: Tasks 4, 5, 6, 7, 8, 9, 10  
**Acceptance Criteria**:

- [ ] `ContextType = 'dm' | 'group'` exported
- [ ] `ChatUser` gains `isAdmin: boolean`
- [ ] `IncomingMessage` gains `contextId: string`, `contextType: ContextType`, `isMentioned: boolean`
- [ ] `AuthorizationResult` type exported with `allowed`, `isBotAdmin`, `isGroupAdmin`, `storageContextId`
- [ ] `CommandHandler` updated to `(msg, reply, auth) => Promise<void>`
- [ ] `bun typecheck` produces only errors in files not yet updated (expected)

**Files**:

- Modify: `src/chat/types.ts`

---

### Task 4: Authorization Engine (`src/bot.ts`)

**Estimate**: 3h ±1h | **Assignee**: Backend | **Priority**: High  
**Depends on**: Tasks 2, 3  
**Acceptance Criteria**:

- [ ] `checkAuthorizationExtended()` returns correct `AuthorizationResult` for all 6 branches:
  1. Bot admin in DM → `{allowed:true, isBotAdmin:true, storageContextId: userId}`
  2. Bot admin in group → `{allowed:true, isBotAdmin:true, storageContextId: groupId}`
  3. Group member in group → `{allowed:true, isBotAdmin:false, isGroupAdmin: <platform flag>}`
  4. Non-member in group → `{allowed:false}`
  5. DM user (via username resolution) → `{allowed:true, isBotAdmin:true}`
  6. Unauthorized DM → `{allowed:false}`
- [ ] `setupBot` `onMessage` handler:
  - Sends unauthorized reply **only** when `!auth.allowed && msg.isMentioned`
  - Silently ignores when `!auth.allowed && !msg.isMentioned`
  - Ignores non-mentioned natural language in groups (`auth.allowed && contextType==='group' && !isMentioned && !commandMatch`)
  - Processes message using `auth.storageContextId`
- [ ] Unit tests cover all 6 auth branches in `tests/bot-auth.test.ts`
- [ ] `bun typecheck` passes once command handlers are updated

**Files**:

- Modify: `src/bot.ts`
- Create: `tests/bot-auth.test.ts`

---

### Task 5: Telegram Provider — Group Support (`src/chat/telegram/index.ts`)

**Estimate**: 4h ±1h | **Assignee**: Backend | **Priority**: High  
**Depends on**: Task 3  
**Acceptance Criteria**:

- [ ] `botUsername` stored after `getMe()` call in `start()`
- [ ] `extractMessage()` populates `contextType`, `contextId`, `isMentioned`, `user.isAdmin`
  - `contextType = 'group'` when `ctx.chat.type` is `'group'` | `'supergroup'` | `'channel'`
  - `contextId = String(ctx.chat.id)` (negative integer for groups)
  - `isMentioned` checked via `ctx.message.entities` type `'mention'` matching `@botUsername`
- [ ] `checkAdminStatus()` calls `getChatAdministrators` (returns `false` on API error — never throws)
- [ ] `registerCommand()` passes `isAdmin` context correctly
- [ ] Group command menus registered with `setMyCommands` for group scope
- [ ] `bun typecheck` passes

**Files**:

- Modify: `src/chat/telegram/index.ts`

**Notes**:

- `getChatAdministrators` can throw (bot not in group, network error) — wrap in `try/catch`, return `false`
- Admin check must be done **once per message event**, not cached between messages (admin status may change)
- Store `botUsername` as instance field; set via `getMe()` on `onStart` callback

---

### Task 6: Mattermost Provider — Group Support (`src/chat/mattermost/index.ts`)

**Estimate**: 4h ±1h | **Assignee**: Backend | **Priority**: High  
**Depends on**: Task 3  
**Acceptance Criteria**:

- [ ] `botUsername` stored from `/api/v4/users/me` response on start
- [ ] `fetchChannelInfo(channelId)` returns channel type; cached to avoid per-message API calls
- [ ] `contextType = 'group'` when channel type is not `'D'`
- [ ] `contextId = channel_id` in all cases
- [ ] `isMentioned` when message contains `@botUsername`
- [ ] `checkChannelAdmin(channelId, userId)` calls `/api/v4/channels/{id}/members/{uid}` and checks `roles`; returns `false` on error
- [ ] `MattermostPostSchema` extended with optional `user_name` field
- [ ] New `UserMeExtendedSchema` retrieves `username` field
- [ ] `bun typecheck` passes

**Files**:

- Modify: `src/chat/mattermost/index.ts`

**Notes**:

- Channel info must be cached (e.g. in a `Map<string, string>`) — Mattermost channels don't change type
- Admin API call is per-message; acceptable for now (can optimize later with short-lived cache)
- Mattermost `channel.type` values: `'D'` (direct), `'G'` (group DM among N people), `'O'` (public), `'P'` (private) — `'G'`, `'O'`, `'P'` all treated as group context

---

### Task 7: Group Commands Module (`src/commands/group.ts`)

**Estimate**: 4h ±1h | **Assignee**: Backend | **Priority**: High  
**Depends on**: Tasks 2, 3, 4  
**Acceptance Criteria**:

- [ ] `/group adduser <@username|userId>` — US3:
  - Rejects non-group-admin with appropriate message
  - Adds member; confirms with success message
  - Handles already-member case (no-op + informs)
  - When called from DM (`contextType === 'dm'`) → tells user "only in groups" (US10)
- [ ] `/group deluser <@username|userId>` — US4:
  - Rejects non-group-admin
  - Removes member; confirms
  - Handles not-found case
  - When called from DM → tells user "only in groups"
- [ ] `/group users` — US5:
  - Accessible to any group member (not just admin)
  - Lists members with `added_by` and `added_at`
  - Empty group message when no members
  - Unauthorized user → no response (handled by auth guard upstream)
  - When called from DM → tells user "only in groups"
- [ ] All three subcommands covered by unit tests in `tests/commands/group.test.ts`
- [ ] `src/commands/index.ts` exports `registerGroupCommand`
- [ ] `src/bot.ts` calls `registerGroupCommand(chat)`
- [ ] `bun test tests/commands/group.test.ts` passes

**Files**:

- Create: `src/commands/group.ts`
- Create: `tests/commands/group.test.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/bot.ts`

---

### Task 8: Storage Context Propagation

**Estimate**: 3h ±1h | **Assignee**: Backend | **Priority**: High  
**Depends on**: Tasks 3, 4  
**Acceptance Criteria**:

- [ ] `processMessage` in `src/llm-orchestrator.ts` receives `auth.storageContextId` (not raw `userId`) — US6, US9
- [ ] `loadHistory` / `appendHistory` / `clearHistory` called with `auth.storageContextId` in all command and message paths
- [ ] `getCachedConfig` / `setCachedConfig` calls use `auth.storageContextId`
- [ ] `clearFacts` / `clearSummary` calls use `auth.storageContextId`
- [ ] Two groups with separate `groupId`s produce independent history, config, and memory — verified by integration test
- [ ] `bun typecheck` passes

**Files**:

- Modify: `src/bot.ts`
- Modify: `src/commands/clear.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/commands/set.ts`
- Modify: `src/commands/context.ts`
- Create: `tests/group-context-isolation.test.ts`

---

### Task 9: Command Restrictions in Group/DM Context

**Estimate**: 3h ±1h | **Assignee**: Backend | **Priority**: Medium  
**Depends on**: Tasks 3, 4, 8  
**Acceptance Criteria**:

- [ ] `/clear` in group — only group admin may clear (`auth.isGroupAdmin`); regular member gets rejection (US7)
- [ ] `/set` in group — only group admin may set config; regular member gets rejection (US8)
- [ ] `/config` in group — only group admin may view config (US8)
- [ ] `/user add|remove` in group chat → rejects with "this command is only available in direct messages" (US11)
- [ ] `/users` in group chat → rejects with same message (US11)
- [ ] `/help` in DM shows no group-management commands; `/help` in group shows no DM-only commands (see Task 10)
- [ ] Unit tests for each restriction in `tests/commands/restrictions.test.ts`

**Files**:

- Modify: `src/commands/clear.ts`
- Modify: `src/commands/set.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/commands/admin.ts`
- Create: `tests/commands/restrictions.test.ts`

---

### Task 10: Help Command — Group-Aware Content

**Estimate**: 1h ±0.5h | **Assignee**: Backend | **Priority**: Medium  
**Depends on**: Tasks 3, 4  
**Acceptance Criteria**:

- [ ] `registerHelpCommand` uses `msg.contextType` to select appropriate help text (US15)
- [ ] Group help text:
  - Lists: `/help`, `/group adduser`, `/group deluser`, `/group users`, natural language via mention
  - Admin suffix when `auth.isGroupAdmin` is true: additionally `/set`, `/config`, `/clear`
  - Omits DM-only commands: `/user`, `/users`, `/context`
- [ ] DM help text unchanged (backward-compatible)
- [ ] Unit test covers both contexts in `tests/commands/help.test.ts`

**Files**:

- Modify: `src/commands/help.ts`
- Create: `tests/commands/help.test.ts`

---

### Task 11: Acceptance Test Suite

**Estimate**: 4h ±1h | **Assignee**: Backend / QA | **Priority**: High  
**Depends on**: Tasks 1–10  
**Acceptance Criteria**:

- [ ] `tests/groups.test.ts` — CRUD + duplicate handling
- [ ] `tests/bot-auth.test.ts` — all 6 authorization branches
- [ ] `tests/commands/group.test.ts` — adduser, deluser, users; DM rejection; admin guard
- [ ] `tests/commands/restrictions.test.ts` — clear/set/config group admin gate; user/users group rejection
- [ ] `tests/commands/help.test.ts` — DM vs group help text diff
- [ ] `tests/group-context-isolation.test.ts` — two groups have independent history and config
- [ ] `bun test` (full suite) passes with no failures
- [ ] `bun check` (typecheck + lint) passes

---

## Risk Assessment Matrix

| Risk                                                                                                                             | Probability | Impact | Mitigation                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `getChatAdministrators` rate-limited by Telegram for busy groups                                                                 | Medium      | Medium | Wrap in try/catch returning `false`; do not cache (membership can change)                                            |
| Mattermost channel API call per message adds latency                                                                             | Medium      | Low    | Cache channel type in a `Map<channelId, 'dm'\|'group'>` (type never changes)                                         |
| Breaking change: `CommandHandler` gains `auth` param — all handlers must be updated simultaneously                               | High        | High   | Update all command files in same PR; CI typecheck gate enforces it                                                   |
| `contextId` for Telegram groups is a **negative** integer — storage keyed on it may collide with existing positive `userId` keys | Low         | High   | Prepend namespace: store as `g:{groupId}` vs `u:{userId}` in all storage keys (or verify no overlap is possible)     |
| Users added by username (not ID) cannot be looked up when they join group where bot has no prior record                          | Medium      | Medium | Extend `addGroupMember` to accept both `userId` and `username` with same resolution logic as `resolveUserByUsername` |
| Bot admin in Telegram group can suppress unrelated group messages by accidentally being authorized                               | Low         | Low    | Auth guard only affects messages directed at bot (mention guard + command prefix)                                    |
| Mattermost `/group deluser` uses username but `group_members` stores user IDs — resolution needed                                | Medium      | Medium | Resolve username → user_id via `/api/v4/users/username/{username}` before storing                                    |

---

## Resource Requirements

- **Development Hours**: 32h ±6h total across all tasks
- **Skills Required**: TypeScript, Drizzle ORM, grammy (Telegram Bot API), Mattermost REST/WebSocket, `bun:test`
- **External Dependencies**: Telegram Bot API (existing), Mattermost API (existing)
- **Testing Requirements**:
  - Unit tests: all new modules (in-memory SQLite, mock pattern from `tests/users.test.ts`)
  - Integration tests: context isolation (in-memory DB, no network)
  - Manual smoke tests: one Telegram test group + one Mattermost test channel recommended before merge

---

## Implementation Sequence

```
Task 1 (schema)
    │
    ▼
Task 2 (groups.ts) ──────────────────────┐
    │                                    │
    ▼                                    │
Task 3 (types) ──────────────────────────┤
    │                                    │
    ├──── Task 4 (bot.ts auth) ──────────┤
    │         │                          │
    │         ├── Task 5 (Telegram)      │
    │         ├── Task 6 (Mattermost)    │
    │         │                          │
    │         ▼                          │
    │     Task 7 (group cmds) ◄──────────┘
    │         │
    │         ▼
    │     Task 8 (storage ctx)
    │         │
    │         ▼
    │     Task 9 (cmd restrictions)
    │         │
    │         ▼
    └───► Task 10 (help)
              │
              ▼
          Task 11 (full test suite)
```

---

## Planning Quality Gates

**✅ Requirements Coverage**

- [x] All 16 acceptance criteria mapped to specific tasks (see User Story → Task Mapping)
- [x] Scope: group chat for Telegram + Mattermost; DM behavior unchanged
- [x] Out of scope: voice/media group handling; group bot removal cleanup; multi-bot deployments
- [x] Non-functional: admin detection per-message (no stale cache); storage isolation enforced at `contextId` level

**✅ Task Specification**

- [x] Each task has measurable completion criteria
- [x] Estimates include confidence intervals
- [x] Dependencies explicitly mapped
- [x] Breaking change (CommandHandler signature) identified and sequenced correctly

**✅ Risk Management**

- [x] Telegram admin rate-limit risk addressed
- [x] Mattermost latency risk addressed with channel-type caching
- [x] `contextId` collision risk flagged with namespace mitigation option

**✅ Timeline Realism**

- [x] Total 32h ±6h with clear critical path: Tasks 1 → 2 → 3 → 4 → {5,6,7} → {8,9,10} → 11
- [x] Tasks 5 and 6 (platform providers) can run in parallel once Task 3 is complete
- [x] Tasks 8, 9, 10 can run in parallel after Task 4

**✅ Library Research Validation**

- [x] grammy `getChatAdministrators` and `getMe` APIs used — both in stable API, no new dependencies
- [x] Mattermost channel endpoint used — standard REST, no new dependencies
- [x] All custom logic limited to business-specific group membership and routing rules

---

## References

- User Stories: `docs/user-stories/group-chat-support.md`
- Architecture Design: `docs/plans/2026-03-20-group-chat-support.md`
- Previous Implementation Plan (reference): `docs/plans/2026-03-20-group-chat-implementation.md`
- Existing test pattern: `tests/users.test.ts`
- Existing command pattern: `src/commands/clear.ts`
