# Group Chat Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable papai bot to work in group chats with group-scoped history, member management, and mention-based responses.

**Architecture:** Extend chat providers to detect group context and mentions, add group membership table, update authorization to support group admins and members, modify storage layer to use context-based identifiers.

**Tech Stack:** TypeScript, Zod, Drizzle ORM, SQLite, Grammy (Telegram), WebSocket (Mattermost)

---

## Task 1: Add Database Schema for Group Members

**Files:**

- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/YYYY_MM_DD_add_group_members.ts`

**Step 1: Add group_members table to schema**

Add to `src/db/schema.ts`:

```typescript
export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    addedBy: text('added_by').notNull(),
    addedAt: text('added_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('idx_group_members_group').on(table.groupId),
    index('idx_group_members_user').on(table.userId),
  ],
)

export type GroupMember = typeof groupMembers.$inferSelect
```

**Step 2: Create migration file**

Create `src/db/migrations/2026_03_20_add_group_members.ts`:

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

**Step 3: Verify schema compiles**

Run: `bun typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add group_members table schema"
```

---

## Task 2: Create Groups Module

**Files:**

- Create: `src/groups.ts`
- Create: `tests/groups.test.ts`

**Step 1: Write failing test**

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

**Step 2: Implement groups module**

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

  db.insert(groupMembers)
    .values({
      groupId,
      userId,
      addedBy,
    })
    .onConflictDoNothing()
    .run()

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
  const db = getDzzleDb()

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
  // Platform-specific implementations will be added in Task 6
  return false
}
```

**Step 3: Fix typo and run tests**

Fix typo: `getDzzleDb` -> `getDrizzleDb`

Run: `bun test tests/groups.test.ts`
Expected: PASS - all 4 tests

**Step 4: Commit**

```bash
git add src/groups.ts tests/groups.test.ts
git commit -m "feat: add groups module with CRUD operations"
```

---

## Task 3: Update Chat Types

**Files:**

- Modify: `src/chat/types.ts`

**Step 1: Update IncomingMessage type**

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
  isMentioned: boolean // bot was @mentioned in this message
  text: string
  commandMatch?: string
}

export type CommandHandler = (
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult, // new parameter
) => Promise<void>

export type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
}
```

**Step 2: Verify changes compile**

Run: `bun typecheck`
Expected: Errors (handlers need updating - expected)

**Step 3: Commit**

```bash
git add src/chat/types.ts
git commit -m "feat: update chat types for group support"
```

---

## Task 4: Update Authorization Logic

**Files:**

- Modify: `src/bot.ts`

**Step 1: Write new authorization function**

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

**Step 2: Update onMessage handler**

Modify the onMessage handler to use extended auth:

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

  // Check mention requirement for natural language in groups
  if (msg.contextType === 'group' && !msg.commandMatch && !msg.isMentioned) {
    return // Natural language requires mention in groups
  }

  reply.typing()
  await processMessage(reply, auth.storageContextId, msg.user.username, msg.text)
})
```

**Step 3: Update command registrations**

Modify command handler wrapper to pass auth:

```typescript
// Update all command registrations to use new signature
// This will require updating each command handler
```

**Step 4: Verify typecheck**

Run: `bun typecheck`
Expected: Errors (commands need updating)

**Step 5: Commit**

```bash
git add src/bot.ts
git commit -m "feat: extend authorization for group support"
```

---

## Task 5: Create Group Commands

**Files:**

- Create: `src/commands/group.ts`
- Create: `tests/commands/group.test.ts`

**Step 1: Write failing test**

Create `tests/commands/group.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { addGroupMember, listGroupMembers } from '../../src/groups.js'
import type { AuthorizationResult, IncomingMessage, ReplyFn } from '../../src/chat/types.js'

const createMockAuth = (overrides: Partial<AuthorizationResult> = {}): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: true,
  storageContextId: 'group1',
  ...overrides,
})

const createMockMsg = (overrides: Partial<IncomingMessage> = {}): IncomingMessage => ({
  user: { id: 'user1', username: 'testuser', isAdmin: true },
  contextId: 'group1',
  contextType: 'group',
  isMentioned: false,
  text: '/group adduser @newuser',
  commandMatch: 'adduser @newuser',
  ...overrides,
})

describe('group commands', () => {
  beforeEach(() => {
    const db = getDrizzleDb()
    db.run('DELETE FROM group_members')
  })

  test('adduser adds member when caller is group admin', async () => {
    const reply = {
      text: async (msg: string) => {
        expect(msg).toContain('added')
      },
    } as unknown as ReplyFn
    const msg = createMockMsg({ commandMatch: 'adduser @newuser' })
    const auth = createMockAuth({ isGroupAdmin: true })

    // Import and call handler
    const { handleGroupCommand } = await import('../../src/commands/group.js')
    await handleGroupCommand(msg, reply, auth)

    expect(listGroupMembers('group1')).toHaveLength(1)
  })
})
```

**Step 2: Implement group commands**

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
    await reply.text('Only group admins can add users to the group.')
    return
  }

  if (targetUser === undefined) {
    await reply.text('Usage: /group adduser <@username>')
    return
  }

  // Extract user ID from mention format
  const userId = extractUserId(targetUser)
  if (userId === null) {
    await reply.text('Please provide a valid user mention or ID.')
    return
  }

  addGroupMember(msg.contextId, userId, msg.user.id)
  await reply.text(`User ${targetUser} added to this group.`)
  log.info({ groupId: msg.contextId, userId, addedBy: msg.user.id }, 'Group member added via command')
}

async function handleDelUser(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  targetUser: string | undefined,
): Promise<void> {
  if (!auth.isGroupAdmin) {
    await reply.text('Only group admins can remove users from the group.')
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
  log.info({ groupId: msg.contextId, userId }, 'Group member removed via command')
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
  // Handle @username format
  if (input.startsWith('@')) {
    return input.slice(1)
  }
  // Handle raw user ID
  if (/^\d+$/.test(input) || /^[a-zA-Z0-9_-]+$/.test(input)) {
    return input
  }
  return null
}
```

**Step 3: Register group command in commands/index.ts**

Modify `src/commands/index.ts` to export group command.

**Step 4: Run tests**

Run: `bun test tests/commands/group.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/group.ts tests/commands/group.test.ts
git commit -m "feat: add group management commands"
```

---

## Task 6: Update Telegram Provider

**Files:**

- Modify: `src/chat/telegram/index.ts`

**Step 1: Store bot username**

Add bot username storage:

```typescript
export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  private readonly bot: Bot
  private botUsername: string | null = null

  constructor() {
    // ... existing constructor
  }

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

Update `extractMessage`:

```typescript
private extractMessage(ctx: Context): IncomingMessage | null {
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
      isAdmin: false, // Will be updated later
    },
    contextId,
    contextType,
    isMentioned,
    text,
  }
}

private isBotMentioned(text: string, entities?: MessageEntity[]): boolean {
  if (this.botUsername === null) return false

  // Check for @botname in text
  if (text.includes(`@${this.botUsername}`)) return true

  // Check entities for mentions
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

Add method to check if user is admin:

```typescript
private async checkAdminStatus(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type === 'private') return true
  if (ctx.chat?.id === undefined) return false

  try {
    const admins = await this.bot.api.getChatAdministrators(ctx.chat.id)
    const userId = ctx.from?.id
    if (userId === undefined) return false

    return admins.some(admin => admin.user.id === userId)
  } catch {
    return false
  }
}
```

**Step 4: Update message handler**

Update `onMessage` and `registerCommand` to check admin status:

```typescript
onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
  this.bot.on('message:text', async (ctx) => {
    const isAdmin = await this.checkAdminStatus(ctx)
    const msg = this.extractMessage(ctx, isAdmin)
    if (msg === null) return

    const reply = this.buildReplyFn(ctx)
    await this.withTypingIndicator(ctx, () => handler(msg, reply))
  })
}

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
```

**Step 5: Fix typecheck**

Run: `bun typecheck`
Expected: PASS (after fixing imports)

**Step 6: Commit**

```bash
git add src/chat/telegram/index.ts
git commit -m "feat: update Telegram provider for group support"
```

---

## Task 7: Update Mattermost Provider

**Files:**

- Modify: `src/chat/mattermost/index.ts`

**Step 1: Store bot username**

Add bot username storage and fetch on start:

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
  // ...
}
```

**Step 2: Detect context and mentions**

Update `handlePostedEvent`:

```typescript
private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
  const postJson = data['post']
  if (typeof postJson !== 'string') return

  const postResult = MattermostPostSchema.safeParse(JSON.parse(postJson))
  if (!postResult.success) return
  const post = postResult.data

  if (post.user_id === this.botUserId) return

  // Fetch channel info to determine type
  const channelInfo = await this.fetchChannelInfo(post.channel_id)
  const isGroup = channelInfo.type !== 'D'  // 'D' = direct message
  const contextType: ContextType = isGroup ? 'group' : 'dm'

  // Check if user is admin
  const isAdmin = await this.checkChannelAdmin(post.channel_id, post.user_id)

  const isMentioned = this.isBotMentioned(post.message)

  const reply = this.buildReplyFn(post.channel_id)
  const command = this.matchCommand(post.message)

  const msg: IncomingMessage = {
    user: {
      id: post.user_id,
      username: post.user_name ?? null, // May need to fetch user info
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

**Step 3: Add channel info fetching**

Add methods:

```typescript
private async fetchChannelInfo(channelId: string): Promise<{ type: string }> {
  const data = await this.apiFetch('GET', `/api/v4/channels/${channelId}`, undefined)
  return { type: (data as { type: string }).type }
}

private async checkChannelAdmin(channelId: string, userId: string): Promise<boolean> {
  try {
    const data = await this.apiFetch('GET', `/api/v4/channels/${channelId}/members/${userId}`, undefined)
    const member = data as { roles: string }
    return member.roles.includes('channel_admin') || member.roles.includes('channel_user')
  } catch {
    return false
  }
}
```

**Step 4: Update schema for user name**

Update MattermostPostSchema:

```typescript
const MattermostPostSchema = z.object({
  user_id: z.string(),
  channel_id: z.string(),
  message: z.string(),
  user_name: z.string().optional(), // May be present
})
```

**Step 5: Fix typecheck**

Run: `bun typecheck`
Expected: PASS (after fixing async issues)

**Step 6: Commit**

```bash
git add src/chat/mattermost/index.ts
git commit -m "feat: update Mattermost provider for group support"
```

---

## Task 8: Update All Command Handlers

**Files:**

- Modify: `src/commands/*.ts` (all command files)

**Step 1: Update command handler signatures**

Update all command handlers to accept `AuthorizationResult` parameter:

```typescript
// src/commands/set.ts
export const registerSetCommand = (chat: ChatProvider): void => {
  chat.registerCommand('set', async (msg, reply, auth) => {
    if (!auth.allowed) return

    // In groups, only bot users and group admins can run commands
    if (msg.contextType === 'group' && !auth.isBotAdmin && !auth.isGroupAdmin) {
      await reply.text('Only group admins can run this command.')
      return
    }

    // ... existing logic using auth.storageContextId
  })
}
```

**Step 2: Update each command file**

- `src/commands/set.ts` - Use `auth.storageContextId` for config storage
- `src/commands/config.ts` - Use `auth.storageContextId` for config lookup
- `src/commands/clear.ts` - Use `auth.storageContextId` for clearing history
- `src/commands/help.ts` - No storage changes needed
- `src/commands/context.ts` - Use `auth.storageContextId` for context export
- `src/commands/admin.ts` - Keep bot admin checks, pass auth to handlers

**Step 3: Update register functions**

Update `src/commands/index.ts`:

```typescript
import { registerGroupCommand } from './group.js'

export function registerAllCommands(chat: ChatProvider, adminUserId: string): void {
  registerHelpCommand(chat)
  registerSetCommand(chat)
  registerConfigCommand(chat)
  registerClearCommand(chat)
  registerContextCommand(chat, adminUserId)
  registerAdminCommands(chat, adminUserId)
  registerGroupCommand(chat) // New
}
```

**Step 4: Verify typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/
git commit -m "feat: update all commands for group auth support"
```

---

## Task 9: Update LLM Orchestrator

**Files:**

- Modify: `src/llm-orchestrator.ts`

**Step 1: Update processMessage signature**

The function already accepts `userId` parameter which should be treated as `contextId`:

```typescript
export async function processMessage(
  reply: ReplyFn,
  contextId: string, // renamed from userId
  username: string | null,
  text: string,
): Promise<void> {
  // ... existing logic
}
```

**Step 2: Verify no user-specific logic**

Check that the function doesn't make assumptions about user identity beyond context.

**Step 3: Commit**

```bash
git add src/llm-orchestrator.ts
git commit -m "refactor: rename userId to contextId in processMessage"
```

---

## Task 10: Add Integration Tests

**Files:**

- Create: `tests/group-integration.test.ts`

**Step 1: Write integration test**

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { addGroupMember } from '../src/groups.js'
import { isAuthorized } from '../src/users.js'

describe('group integration', () => {
  beforeEach(() => {
    const db = getDrizzleDb()
    db.run('DELETE FROM group_members')
    db.run('DELETE FROM users')
  })

  test('group member can use bot in group context', () => {
    // Add user as group member
    addGroupMember('group1', 'user1', 'admin1')

    // Should be authorized in group context
    const auth = checkAuthorizationExtended('user1', null, 'group1', 'group', false)
    expect(auth.allowed).toBe(true)
    expect(auth.storageContextId).toBe('group1')
  })

  test('group member cannot use bot in DM', () => {
    // Add user as group member only
    addGroupMember('group1', 'user1', 'admin1')

    // Should NOT be authorized in DM context (not in users table)
    const auth = checkAuthorizationExtended('user1', null, 'user1', 'dm', false)
    expect(auth.allowed).toBe(false)
  })

  test('bot user can use bot in any context', () => {
    // Add user to authorized users
    addUser('user1', 'admin1')

    // Should be authorized in DM
    const dmAuth = checkAuthorizationExtended('user1', null, 'user1', 'dm', false)
    expect(dmAuth.allowed).toBe(true)
    expect(dmAuth.isBotAdmin).toBe(true)

    // Should be authorized in group
    const groupAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', false)
    expect(groupAuth.allowed).toBe(true)
    expect(groupAuth.isBotAdmin).toBe(true)
  })
})
```

**Step 2: Run tests**

Run: `bun test tests/group-integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/group-integration.test.ts
git commit -m "test: add group integration tests"
```

---

## Task 11: Update Documentation

**Files:**

- Modify: `README.md`

**Step 1: Add group chat section**

Add new section to README:

```markdown
## Group Chat Support

The bot can be added to Telegram groups or Mattermost channels for team collaboration.

### Group Features

- **Shared History**: All group members share the same conversation context
- **Shared Configuration**: Task tracker credentials are shared among members
- **Member Management**: Group admins control who can use the bot

### Group Setup

1. Add the bot to your group/channel
2. Group admin runs: `/group adduser @username` to authorize members
3. Group admin configures bot: `/set provider kaneo`, `/set llm_apikey ...`
4. Members mention the bot for natural language: `@bot create task: fix bug`

### Authorization in Groups

- **Group Admin**: Can add/remove members, configure bot, run all commands
- **Group Member**: Can use natural language with mentions only
- **Non-Member**: Gets authorization error when mentioning bot

### Commands in Groups

| Command                              | Requires Mention | Who Can Run      |
| ------------------------------------ | ---------------- | ---------------- |
| `/group adduser`                     | No               | Group Admin      |
| `/group deluser`                     | No               | Group Admin      |
| `/group users`                       | No               | Any Member       |
| `/set`, `/config`, `/clear`, `/help` | No               | Group Admin only |
| Natural language                     | Yes              | Any Member       |
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add group chat documentation"
```

---

## Task 12: Final Verification

**Step 1: Run all tests**

Run: `bun test`
Expected: PASS

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `bun lint`
Expected: PASS

**Step 4: Run full check**

Run: `bun check`
Expected: PASS

**Step 5: Final commit**

```bash
git commit -m "feat: complete group chat support implementation" --allow-empty
```

---

## Summary

This implementation adds full group chat support to papai with:

1. **Database**: New `group_members` table for group membership
2. **Types**: Extended `IncomingMessage` with context and mention info
3. **Authorization**: Two-tier auth (bot users vs group members)
4. **Commands**: `/group adduser`, `/group deluser`, `/group users`
5. **Providers**: Telegram and Mattermost updated for group detection
6. **Logic**: Mention-based responses in groups, shared config/history

All changes are backward compatible - DMs continue to work as before.
