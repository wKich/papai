# Group Chat Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable papai bot to work in group chats with group-scoped history, member management, and mention-based responses.

**Architecture:** Extend chat providers to detect group context and mentions, add group membership table, update authorization to support group admins and members, modify storage layer to use context-based identifiers.

**Tech Stack:** TypeScript, Zod, Drizzle ORM, SQLite, Grammy (Telegram), WebSocket (Mattermost)

**Estimated Effort:** 32h ±6h across all tasks

---

## User Story → Task Mapping

| User Story | Description                                 | Key Tasks                                                             |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------- |
| US 1       | Bot detects group vs DM context             | Task 4, 5 (provider detection); Task 3 (auth); Task 6 (mention guard) |
| US 2       | Bot rejects unauthorized mentions in groups | Task 3 (rejection reply on mention); Task 6 (message guard)           |
| US 3       | Group admin can add members                 | Task 1 (schema); Task 2 (groups module); Task 7 (group commands)      |
| US 4       | Group admin can remove members              | Task 1 (schema); Task 2 (groups module); Task 7 (group commands)      |
| US 5       | Any member can list group users             | Task 2 (groups module); Task 7 (group commands)                       |
| US 6       | Group shares conversation history           | Task 8 (contextId as storage key throughout)                          |
| US 7       | Group admin can clear history               | Task 9 (clear command group restrictions)                             |
| US 8       | Group admin can configure bot               | Task 9 (set/config group restrictions)                                |
| US 9       | Groups have isolated context                | Task 8 (contextId isolation by group)                                 |
| US 10      | Group commands reject in DM                 | Task 7 (group command rejects in DM context)                          |
| US 11      | User commands reject in groups              | Task 9 (user/users command rejects in group context)                  |
| US 12      | Natural language requires mention           | Task 6 (mention guard in message handler)                             |
| US 13      | Commands don't require mention              | Task 6 (commands bypass mention requirement)                          |
| US 14      | Immediate revocation when removed           | Task 2 (immediate DB delete); Task 3 (auth checks on every message)   |
| US 15      | Help shows group-aware text                 | Task 10 (help command group-aware text)                               |
| US 16      | Bot admin bypasses membership               | Task 3 (bot admin bypasses group membership check)                    |

---

## Technical Architecture

### Current State vs Target State

| Concern           | Current                | Target                                                        |
| ----------------- | ---------------------- | ------------------------------------------------------------- |
| Storage key       | `userId` always        | `contextId` - `userId` in DMs, `groupId` in groups            |
| Auth              | Single tier (DM only)  | Two-tier: bot users + group members                           |
| `IncomingMessage` | No context info        | Has `contextType`, `contextId`, `isMentioned`, `user.isAdmin` |
| `CommandHandler`  | `(msg, reply) => void` | `(msg, reply, auth) => void`                                  |
| Telegram          | No group detection     | Detects via `chat.type`                                       |
| Mattermost        | No channel detection   | Detects via channel API                                       |

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
    └─ storageContextId: string
             │
         ┌───┴──────────────────┐
         ▼                      ▼
    CommandHandler      onMessage handler
    (uses auth)         (mention guard)
```

### Authorization Matrix

| Command                              | DM  | Group | Mention Required | Permission Required                  |
| ------------------------------------ | --- | ----- | ---------------- | ------------------------------------ |
| `/user add/remove`                   | ✓   | ✗     | N/A              | Bot Admin                            |
| `/users`                             | ✓   | ✗     | N/A              | Bot Admin                            |
| `/group adduser/deluser`             | ✗   | ✓     | No               | Group Admin                          |
| `/group users`                       | ✗   | ✓     | No               | Any Group Member                     |
| `/set`, `/config`, `/clear`, `/help` | ✓   | ✓     | No               | Bot User (DM) or Group Admin (Group) |
| Natural language                     | ✗   | ✓     | **Yes**          | Group Member only                    |
| Unauthorized mention                 | ✗   | ✓     | Yes              | Reply with auth error                |

### Database Schema

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

---

## Risk Assessment

| Risk                                                    | Probability | Impact | Mitigation                                          |
| ------------------------------------------------------- | ----------- | ------ | --------------------------------------------------- |
| Telegram rate limiting on `getChatAdministrators`       | Medium      | Medium | Wrap in try/catch, return `false` on error          |
| Mattermost API latency per message                      | Medium      | Low    | Cache channel type in Map (type never changes)      |
| Breaking change: `CommandHandler` signature             | High        | High   | Update all handlers in single PR                    |
| Context ID collision (Telegram groups use negative IDs) | Low         | High   | Verify namespace or prepend type prefix             |
| Username resolution for group members                   | Medium      | Medium | Accept both userId and username in `/group adduser` |

---

## Implementation Sequence

```
Task 1 (schema)
    │
    ▼
Task 2 (groups module) ──────────────────┐
    │                                    │
    ▼                                    │
Task 3 (types) ──────────────────────────┤
    │                                    │
    ├──── Task 4 (authorization) ────────┤
    │         │                          │
    │         ├── Task 5 (Telegram)      │
    │         ├── Task 6 (Mattermost)    │
    │         │                          │
    │         ▼                          │
    │     Task 7 (group commands) ◄──────┘
    │         │
    │         ▼
    │     Task 8 (storage propagation)
    │         │
    │         ▼
    │     Task 9 (command restrictions)
    │         │
    │         ▼
    └───► Task 10 (help command)
              │
              ▼
          Task 11 (tests)
              │
              ▼
          Task 12 (docs + final verification)
```

---

## Task 1: Database Schema — Group Members Table

**Estimate:** 2h ±0.5h | **Priority:** High | **Blocks:** Tasks 2, 7

**Files:**

- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/008_group_members.ts`

**Step 1: Add table to schema**

Add to `src/db/schema.ts`:

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

**Step 2: Create migration**

Create `src/db/migrations/008_group_members.ts`:

```typescript
import { sql } from 'drizzle-orm'

export function up(): string {
  return `
    CREATE TABLE group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')) NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );
    
    CREATE INDEX idx_group_members_group ON group_members(group_id);
    CREATE INDEX idx_group_members_user ON group_members(user_id);
  `
}

export function down(): string {
  return `
    DROP INDEX idx_group_members_user;
    DROP INDEX idx_group_members_group;
    DROP TABLE group_members;
  `
}
```

**Step 3: Verify**

Run: `bun typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add group_members table schema"
```

---

## Task 2: Groups Module

**Estimate:** 3h ±1h | **Priority:** High | **Depends on:** Task 1

**Files:**

- Create: `src/groups.ts`
- Create: `tests/groups.test.ts`

**Acceptance Criteria:**

- [ ] `addGroupMember()` inserts; duplicate is no-op
- [ ] `removeGroupMember()` deletes
- [ ] `isGroupMember()` returns boolean
- [ ] `listGroupMembers()` returns rows with user_id, added_by, added_at

**Step 1: Write failing tests**

Create `tests/groups.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { addGroupMember, isGroupMember, listGroupMembers, removeGroupMember } from '../src/groups.js'

describe('groups', () => {
  beforeEach(() => {
    const db = getDrizzleDb()
    db.run('DELETE FROM group_members')
  })

  test('addGroupMember adds member to group', () => {
    addGroupMember('group1', 'user1', 'admin1')
    expect(isGroupMember('group1', 'user1')).toBe(true)
  })

  test('isGroupMember returns false for non-member', () => {
    expect(isGroupMember('group1', 'user2')).toBe(false)
  })

  test('removeGroupMember removes member', () => {
    addGroupMember('group1', 'user1', 'admin1')
    removeGroupMember('group1', 'user1')
    expect(isGroupMember('group1', 'user1')).toBe(false)
  })

  test('listGroupMembers returns all members', () => {
    addGroupMember('group1', 'user1', 'admin1')
    addGroupMember('group1', 'user2', 'admin1')
    const members = listGroupMembers('group1')
    expect(members).toHaveLength(2)
    expect(members.map((m) => m.user_id).sort()).toEqual(['user1', 'user2'])
  })
})
```

Run: `bun test tests/groups.test.ts`
Expected: FAIL - modules not found

**Step 2: Implement module**

Create `src/groups.ts`:

```typescript
import { and, eq, sql } from 'drizzle-orm'
import { getDrizzleDb } from './db/drizzle.js'
import { groupMembers } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'groups' })

export function addGroupMember(groupId: string, userId: string, addedBy: string): void {
  log.debug({ groupId, userId, addedBy }, 'addGroupMember called')
  const db = getDrizzleDb()

  db.insert(groupMembers).values({ groupId, userId, addedBy }).onConflictDoNothing().run()

  log.info({ groupId, userId, addedBy }, 'Group member added')
}

export function removeGroupMember(groupId: string, userId: string): void {
  log.debug({ groupId, userId }, 'removeGroupMember called')
  const db = getDrizzleDb()

  db.delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .run()

  log.info({ groupId, userId }, 'Group member removed')
}

export function isGroupMember(groupId: string, userId: string): boolean {
  log.debug({ groupId, userId }, 'isGroupMember called')
  const db = getDrizzleDb()

  const row = db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get()

  return row !== undefined
}

export function listGroupMembers(groupId: string): Array<{
  user_id: string
  added_by: string
  added_at: string
}> {
  log.debug({ groupId }, 'listGroupMembers called')
  const db = getDrizzleDb()

  return db
    .select({
      user_id: groupMembers.userId,
      added_by: groupMembers.addedBy,
      added_at: groupMembers.addedAt,
    })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(sql`${groupMembers.addedAt} DESC`)
    .all()
}

export async function isGroupAdmin(platform: string, groupId: string, userId: string): Promise<boolean> {
  log.debug({ platform, groupId, userId }, 'isGroupAdmin called')
  // Platform-specific implementations in Task 5 & 6
  return false
}
```

**Step 3: Run tests**

Run: `bun test tests/groups.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/groups.ts tests/groups.test.ts
git commit -m "feat: add groups module with CRUD operations"
```

---

## Task 3: Update Chat Types

**Estimate:** 1h ±0.5h | **Priority:** High | **Blocks:** Tasks 4-10

**Files:**

- Modify: `src/chat/types.ts`

**Acceptance Criteria:**

- [ ] `ContextType = 'dm' | 'group'` exported
- [ ] `ChatUser` gains `isAdmin: boolean`
- [ ] `IncomingMessage` gains `contextId`, `contextType`, `isMentioned`
- [ ] `AuthorizationResult` exported with `allowed`, `isBotAdmin`, `isGroupAdmin`, `storageContextId`
- [ ] `CommandHandler` updated to accept `auth` parameter

**Step 1: Update types**

Modify `src/chat/types.ts`:

```typescript
export type ContextType = 'dm' | 'group'

export type ChatUser = {
  id: string
  username: string | null
  isAdmin: boolean // platform admin in current context
}

export type IncomingMessage = {
  user: ChatUser
  contextId: string // storage key: userId in DMs, groupId in groups
  contextType: ContextType
  isMentioned: boolean // bot was @mentioned
  text: string
  commandMatch?: string
}

export type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
}

export type CommandHandler = (msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void>
```

**Step 2: Verify**

Run: `bun typecheck`
Expected: Errors in files not yet updated (expected)

**Step 3: Commit**

```bash
git add src/chat/types.ts
git commit -m "feat: update chat types for group support"
```

---

## Task 4: Update Authorization Logic

**Estimate:** 3h ±1h | **Priority:** High | **Depends on:** Tasks 2, 3

**Files:**

- Modify: `src/bot.ts`
- Create: `tests/bot-auth.test.ts`

**Acceptance Criteria:**

- [ ] `checkAuthorizationExtended()` handles all 6 branches correctly
- [ ] `onMessage` sends unauthorized reply only when mentioned
- [ ] Natural language in groups requires mention
- [ ] All 6 auth branches covered by tests

**Step 1: Add authorization function**

Add to `src/bot.ts`:

```typescript
import { isGroupMember } from './groups.js'
import type { AuthorizationResult, ContextType } from './chat/types.js'

const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  isPlatformAdmin: boolean,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType }, 'Checking authorization')

  // Bot admin can do everything
  if (isAuthorized(userId)) {
    return {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: isPlatformAdmin,
      storageContextId: contextType === 'dm' ? userId : contextId,
    }
  }

  // In groups, check group membership
  if (contextType === 'group') {
    if (isGroupMember(contextId, userId)) {
      return {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: isPlatformAdmin,
        storageContextId: contextId,
      }
    }
    return {
      allowed: false,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: contextId,
    }
  }

  // In DMs, try to resolve by username
  if (username !== null && resolveUserByUsername(userId, username)) {
    return {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: userId,
    }
  }

  return {
    allowed: false,
    isBotAdmin: false,
    isGroupAdmin: false,
    storageContextId: userId,
  }
}
```

**Step 2: Update message handler**

Modify `onMessage` in `src/bot.ts`:

```typescript
chat.onMessage(async (msg, reply) => {
  const auth = checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.user.isAdmin,
  )

  if (!auth.allowed) {
    if (msg.isMentioned) {
      await reply.text(
        "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
      )
    }
    return
  }

  // Natural language in groups requires mention
  if (msg.contextType === 'group' && !msg.commandMatch && !msg.isMentioned) {
    return // Silent ignore
  }

  reply.typing()
  await processMessage(reply, auth.storageContextId, msg.user.username, msg.text)
})
```

**Step 3: Verify**

Run: `bun typecheck`
Expected: Errors (commands need updating)

**Step 4: Commit**

```bash
git add src/bot.ts
git commit -m "feat: extend authorization for group support"
```

---

## Task 5: Update Telegram Provider

**Estimate:** 4h ±1h | **Priority:** High | **Depends on:** Task 3

**Files:**

- Modify: `src/chat/telegram/index.ts`

**Acceptance Criteria:**

- [ ] `botUsername` stored from `getMe()`
- [ ] `extractMessage()` populates `contextType`, `contextId`, `isMentioned`, `user.isAdmin`
- [ ] `checkAdminStatus()` calls `getChatAdministrators`
- [ ] Group detection via `chat.type`

**Step 1: Store bot username**

```typescript
export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  private readonly bot: Bot
  private botUsername: string | null = null

  async start(): Promise<void> {
    await this.bot.start({
      onStart: async () => {
        const me = await this.bot.api.getMe()
        this.botUsername = me.username ?? null
        log.info({ botUsername: this.botUsername }, 'Telegram bot is running')
      },
    })
  }
  // ...
}
```

**Step 2: Detect context and mentions**

```typescript
private extractMessage(ctx: Context, isAdmin: boolean): IncomingMessage | null {
  const id = ctx.from?.id
  if (id === undefined) return null

  const chatType = ctx.chat?.type
  const isGroup = chatType === 'group' || chatType === 'supergroup' || chatType === 'channel'
  const contextId = String(ctx.chat?.id ?? id)
  const contextType: ContextType = isGroup ? 'group' : 'dm'

  const text = ctx.message?.text ?? ''
  const isMentioned = this.isBotMentioned(text, ctx.message?.entities)

  return {
    user: {
      id: String(id),
      username: ctx.from?.username ?? null,
      isAdmin,
    },
    contextId,
    contextType,
    isMentioned,
    text,
  }
}

private isBotMentioned(text: string, entities?: MessageEntity[]): boolean {
  if (this.botUsername === null) return false
  if (text.includes(`@${this.botUsername}`)) return true

  if (entities !== undefined) {
    for (const entity of entities) {
      if (entity.type === 'mention') {
        const mentionText = text.slice(entity.offset, entity.offset + entity.length)
        if (mentionText === `@${this.botUsername}`) return true
      }
    }
  }

  return false
}
```

**Step 3: Check admin status**

```typescript
private async checkAdminStatus(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type === 'private') return true
  if (ctx.chat?.id === undefined) return false

  try {
    const admins = await this.bot.api.getChatAdministrators(ctx.chat.id)
    const userId = ctx.from?.id
    if (userId === undefined) return false
    return admins.some((admin) => admin.user.id === userId)
  } catch {
    return false
  }
}
```

**Step 4: Update message handlers**

Update `onMessage` and `registerCommand` to check admin status and pass updated message.

**Step 5: Verify**

Run: `bun typecheck`
Expected: PASS after fixing imports

**Step 6: Commit**

```bash
git add src/chat/telegram/index.ts
git commit -m "feat: update Telegram provider for group support"
```

---

## Task 6: Update Mattermost Provider

**Estimate:** 4h ±1h | **Priority:** High | **Depends on:** Task 3

**Files:**

- Modify: `src/chat/mattermost/index.ts`

**Acceptance Criteria:**

- [ ] `botUsername` stored from `/api/v4/users/me`
- [ ] Channel type detection via `/api/v4/channels/{id}`
- [ ] `isMentioned` when message contains `@botUsername`
- [ ] Admin detection via `/api/v4/channels/{id}/members/{uid}`

**Step 1: Store bot username**

```typescript
export class MattermostChatProvider implements ChatProvider {
  // ... existing fields
  private botUsername: string | null = null

  async start(): Promise<void> {
    const data = await this.apiFetch('GET', '/api/v4/users/me', undefined)
    const user = UserMeSchema.parse(data)
    this.botUserId = user.id
    this.botUsername = user.username ?? null
    log.info({ botUserId: this.botUserId, botUsername: this.botUsername }, 'Mattermost bot started')
    this.connectWebSocket()
  }
}
```

**Step 2: Detect context and mentions**

```typescript
private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
  const postJson = data['post']
  if (typeof postJson !== 'string') return

  const postResult = MattermostPostSchema.safeParse(JSON.parse(postJson))
  if (!postResult.success) return
  const post = postResult.data

  if (post.user_id === this.botUserId) return

  const channelInfo = await this.fetchChannelInfo(post.channel_id)
  const isGroup = channelInfo.type !== 'D'
  const contextType: ContextType = isGroup ? 'group' : 'dm'

  const isAdmin = await this.checkChannelAdmin(post.channel_id, post.user_id)
  const isMentioned = this.isBotMentioned(post.message)

  const reply = this.buildReplyFn(post.channel_id)
  const command = this.matchCommand(post.message)

  const msg: IncomingMessage = {
    user: {
      id: post.user_id,
      username: post.user_name ?? null,
      isAdmin,
    },
    contextId: post.channel_id,
    contextType,
    isMentioned,
    text: post.message,
    commandMatch: command?.match,
  }

  if (command !== null) {
    await command.handler(msg, reply)
    return
  }

  if (this.messageHandler !== null) {
    await this.messageHandler(msg, reply)
  }
}

private isBotMentioned(message: string): boolean {
  if (this.botUsername === null) return false
  return message.includes(`@${this.botUsername}`)
}
```

**Step 3: Add helper methods**

```typescript
private async fetchChannelInfo(channelId: string): Promise<{ type: string }> {
  const data = await this.apiFetch('GET', `/api/v4/channels/${channelId}`, undefined)
  return { type: (data as { type: string }).type }
}

private async checkChannelAdmin(channelId: string, userId: string): Promise<boolean> {
  try {
    const data = await this.apiFetch('GET', `/api/v4/channels/${channelId}/members/${userId}`, undefined)
    const member = data as { roles: string }
    return member.roles.includes('channel_admin')
  } catch {
    return false
  }
}
```

**Step 4: Verify**

Run: `bun typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/chat/mattermost/index.ts
git commit -m "feat: update Mattermost provider for group support"
```

---

## Task 7: Create Group Commands

**Estimate:** 4h ±1h | **Priority:** High | **Depends on:** Tasks 2, 3, 4

**Files:**

- Create: `src/commands/group.ts`
- Create: `tests/commands/group.test.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/bot.ts`

**Acceptance Criteria:**

- [ ] `/group adduser <@username>` - adds member, rejects non-admins
- [ ] `/group deluser <@username>` - removes member, rejects non-admins
- [ ] `/group users` - lists members, accessible to any member
- [ ] All commands reject in DM context (US10)

**Step 1: Create command module**

Create `src/commands/group.ts`:

```typescript
import type { AuthorizationResult, CommandHandler, IncomingMessage, ReplyFn } from '../chat/types.js'
import { addGroupMember, listGroupMembers, removeGroupMember } from '../groups.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:group' })

export const handleGroupCommand: CommandHandler = async (
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<void> => {
  if (msg.contextType !== 'group') {
    await reply.text('Group commands can only be used in group chats.')
    return
  }

  if (!msg.commandMatch) {
    await reply.text('Usage: /group adduser <@username> | /group deluser <@username> | /group users')
    return
  }

  const [subcommand, ...args] = msg.commandMatch.trim().split(/\s+/)
  const targetUser = args[0]

  switch (subcommand) {
    case 'adduser':
      await handleAddUser(msg, reply, auth, targetUser)
      break
    case 'deluser':
      await handleDelUser(msg, reply, auth, targetUser)
      break
    case 'users':
      await handleListUsers(msg, reply, auth)
      break
    default:
      await reply.text(
        'Unknown subcommand. Usage: /group adduser <@username> | /group deluser <@username> | /group users',
      )
  }
}

async function handleAddUser(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  targetUser: string | undefined,
): Promise<void> {
  if (!auth.isGroupAdmin) {
    await reply.text('Only group admins can add users.')
    return
  }

  if (targetUser === undefined) {
    await reply.text('Usage: /group adduser <@username>')
    return
  }

  const userId = extractUserId(targetUser)
  if (userId === null) {
    await reply.text('Please provide a valid user mention or ID.')
    return
  }

  addGroupMember(msg.contextId, userId, msg.user.id)
  await reply.text(`User ${targetUser} added to this group.`)
  log.info({ groupId: msg.contextId, userId }, 'Group member added')
}

async function handleDelUser(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  targetUser: string | undefined,
): Promise<void> {
  if (!auth.isGroupAdmin) {
    await reply.text('Only group admins can remove users.')
    return
  }

  if (targetUser === undefined) {
    await reply.text('Usage: /group deluser <@username>')
    return
  }

  const userId = extractUserId(targetUser)
  if (userId === null) {
    await reply.text('Please provide a valid user mention or ID.')
    return
  }

  removeGroupMember(msg.contextId, userId)
  await reply.text(`User ${targetUser} removed from this group.`)
  log.info({ groupId: msg.contextId, userId }, 'Group member removed')
}

async function handleListUsers(msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult): Promise<void> {
  const members = listGroupMembers(msg.contextId)

  if (members.length === 0) {
    await reply.text('No members in this group yet.')
    return
  }

  const memberList = members.map((m) => `- ${m.user_id} (added by ${m.added_by})`).join('\n')
  await reply.text(`Group members:\n${memberList}`)
}

function extractUserId(input: string): string | null {
  if (input.startsWith('@')) {
    return input.slice(1)
  }
  if (/^\d+$/.test(input) || /^[a-zA-Z0-9_-]+$/.test(input)) {
    return input
  }
  return null
}
```

**Step 2: Register command**

Modify `src/commands/index.ts`:

```typescript
import { handleGroupCommand } from './group.js'

export function registerAllCommands(chat: ChatProvider, adminUserId: string): void {
  // ... existing registrations
  chat.registerCommand('group', handleGroupCommand)
}
```

**Step 3: Write tests**

Create `tests/commands/group.test.ts` with tests for:

- Adduser with admin permissions
- Adduser rejected without admin
- Deluser functionality
- Users list
- DM context rejection

**Step 4: Verify**

Run: `bun test tests/commands/group.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/group.ts tests/commands/group.test.ts src/commands/index.ts
git commit -m "feat: add group management commands"
```

---

## Task 8: Propagate Storage Context

**Estimate:** 3h ±1h | **Priority:** High | **Depends on:** Tasks 3, 4

**Files:**

- Modify: `src/bot.ts` (already done in Task 4)
- Modify: `src/commands/clear.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/commands/set.ts`
- Modify: `src/commands/context.ts`
- Modify: `src/llm-orchestrator.ts`
- Create: `tests/group-context-isolation.test.ts`

**Acceptance Criteria:**

- [ ] All storage calls use `auth.storageContextId`
- [ ] Groups have isolated history, config, memory

**Step 1: Update each command**

For each command file, update to use `auth.storageContextId`:

```typescript
// Example for clear.ts
export const registerClearCommand = (chat: ChatProvider): void => {
  chat.registerCommand('clear', async (msg, reply, auth) => {
    if (!auth.allowed) return
    clearHistory(auth.storageContextId)
    // ... rest of logic
  })
}
```

**Step 2: Update LLM orchestrator**

Rename parameter in `src/llm-orchestrator.ts`:

```typescript
export async function processMessage(
  reply: ReplyFn,
  contextId: string, // was userId
  username: string | null,
  text: string,
): Promise<void> {
  // ... existing logic
}
```

**Step 3: Create isolation test**

Create `tests/group-context-isolation.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import { addGroupMember } from '../src/groups.js'
import { addUser } from '../src/users.js'
import { checkAuthorizationExtended } from '../src/bot.js'

describe('group context isolation', () => {
  beforeEach(() => {
    // Clear tables
  })

  test('two groups have independent storage contexts', () => {
    // Add members to two different groups
    // Verify storageContextId is different for each
  })
})
```

**Step 4: Commit**

```bash
git add src/commands/ src/llm-orchestrator.ts tests/group-context-isolation.test.ts
git commit -m "feat: propagate storage context through all layers"
```

---

## Task 9: Command Context Restrictions

**Estimate:** 3h ±1h | **Priority:** Medium | **Depends on:** Tasks 3, 4, 8

**Files:**

- Modify: `src/commands/clear.ts`
- Modify: `src/commands/set.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/commands/admin.ts`
- Create: `tests/commands/restrictions.test.ts`

**Acceptance Criteria:**

- [ ] `/clear`, `/set`, `/config` in groups: admin only (US7, US8)
- [ ] `/user`, `/users` in groups: reject with DM-only message (US11)

**Step 1: Update command restrictions**

For each restricted command, add guard:

```typescript
// Example for set.ts
chat.registerCommand('set', async (msg, reply, auth) => {
  if (!auth.allowed) return

  // In groups, only bot users and group admins can run commands
  if (msg.contextType === 'group' && !auth.isBotAdmin && !auth.isGroupAdmin) {
    await reply.text('Only group admins can run this command.')
    return
  }

  // ... rest of logic
})
```

**Step 2: Update admin commands**

Modify `src/commands/admin.ts`:

```typescript
chat.registerCommand('user', async (msg, reply, auth) => {
  if (msg.contextType === 'group') {
    await reply.text('This command is only available in direct messages.')
    return
  }
  // ... existing logic
})

chat.registerCommand('users', async (msg, reply, auth) => {
  if (msg.contextType === 'group') {
    await reply.text('This command is only available in direct messages.')
    return
  }
  // ... existing logic
})
```

**Step 3: Write restriction tests**

Create `tests/commands/restrictions.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

describe('command restrictions', () => {
  test('/set rejected for non-admin in group', async () => {
    // Test that regular member cannot run /set in group
  })

  test('/user rejected in group', async () => {
    // Test that /user command fails in group context
  })
})
```

**Step 4: Commit**

```bash
git add src/commands/ tests/commands/restrictions.test.ts
git commit -m "feat: add command context restrictions"
```

---

## Task 10: Update Help Command

**Estimate:** 1h ±0.5h | **Priority:** Medium | **Depends on:** Tasks 3, 4

**Files:**

- Modify: `src/commands/help.ts`
- Create: `tests/commands/help.test.ts`

**Acceptance Criteria:**

- [ ] Help text differs for DM vs Group context (US15)
- [ ] Group help shows admin-only commands only when `auth.isGroupAdmin`

**Step 1: Update help command**

Modify `src/commands/help.ts`:

```typescript
export const registerHelpCommand = (chat: ChatProvider): void => {
  chat.registerCommand('help', async (msg, reply, auth) => {
    if (msg.contextType === 'dm') {
      await reply.text(getDmHelpText())
    } else {
      await reply.text(getGroupHelpText(auth.isGroupAdmin))
    }
  })
}

function getDmHelpText(): string {
  return `Available commands:
/help - Show this help
/set <key> <value> - Set configuration
/config - View configuration
/clear - Clear conversation history
/user add <id> - Add authorized user
/user remove <id> - Remove authorized user
/users - List authorized users`
}

function getGroupHelpText(isAdmin: boolean): string {
  let text = `Group commands:
/help - Show this help
/group adduser <@username> - Add member to group
/group deluser <@username> - Remove member from group
/group users - List group members

Mention me with @botname for natural language queries`

  if (isAdmin) {
    text += `

Admin commands:
/set <key> <value> - Set group configuration
/config - View group configuration
/clear - Clear group conversation history`
  }

  return text
}
```

**Step 2: Write tests**

Create `tests/commands/help.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

describe('help command', () => {
  test('DM help shows user management commands', async () => {
    // Verify DM help includes /user, /users
  })

  test('Group help shows group commands', async () => {
    // Verify group help includes /group commands
  })

  test('Group admin help includes config commands', async () => {
    // Verify admin sees /set, /config, /clear
  })
})
```

**Step 3: Commit**

```bash
git add src/commands/help.ts tests/commands/help.test.ts
git commit -m "feat: update help command for group context"
```

---

## Task 11: Comprehensive Test Suite

**Estimate:** 4h ±1h | **Priority:** High | **Depends on:** Tasks 1-10

**Files:**

- Various test files (already created in previous tasks)

**Acceptance Criteria:**

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] `bun test` shows no failures
- [ ] `bun check` passes (typecheck + lint)

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Run checks**

Run: `bun check`
Expected: PASS

**Step 3: Fix any failures**

Address any test or lint failures.

**Step 4: Commit**

```bash
git commit -m "test: complete group chat test suite"
```

---

## Task 12: Documentation and Final Verification

**Estimate:** 2h ±0.5h | **Priority:** Medium | **Depends on:** Tasks 1-11

**Files:**

- Modify: `README.md`

**Acceptance Criteria:**

- [ ] README updated with group chat section
- [ ] All 16 user story acceptance criteria verified
- [ ] Manual smoke test performed (if possible)

**Step 1: Update README**

Add section to README:

```markdown
## Group Chat Support

The bot can be added to Telegram groups or Mattermost channels for team collaboration.

### Quick Start

1. Add bot to your group
2. Group admin runs: `/group adduser @username` to authorize members
3. Group admin configures: `/set provider kaneo`, `/set llm_apikey ...`
4. Members mention: `@bot create task: fix bug`

### Authorization

- **Group Admin**: Full access (add/remove members, configure bot)
- **Group Member**: Natural language queries via mention only
- **Non-Member**: Gets auth error when mentioning bot

### Commands

| Command                              | In Group | Who Can Run               |
| ------------------------------------ | -------- | ------------------------- |
| `/group adduser/deluser`             | ✓        | Group Admin               |
| `/group users`                       | ✓        | Any Member                |
| `/set`, `/config`, `/clear`, `/help` | ✓        | Group Admin only          |
| Natural language                     | ✓        | Any Member (with mention) |
| `/user`, `/users`                    | ✗        | DM only                   |
```

**Step 2: Verify user stories**

Check all 16 user stories have been implemented:

- US 1-16: Review and verify

**Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: add group chat documentation"
git commit -m "feat: complete group chat support implementation" --allow-empty
```

---

## Summary

This implementation adds full group chat support to papai:

1. **Database**: `group_members` table with proper indexes
2. **Groups Module**: CRUD operations for membership
3. **Types**: Extended message types with context info
4. **Authorization**: Two-tier auth (bot users + group members)
5. **Providers**: Telegram and Mattermost group detection
6. **Commands**: `/group adduser`, `/group deluser`, `/group users`
7. **Storage**: Context isolation (userId vs groupId)
8. **Restrictions**: Commands properly gated by context
9. **Help**: Context-aware help text
10. **Tests**: Comprehensive coverage
11. **Docs**: README updated

All changes are backward compatible - existing DM functionality unchanged.
