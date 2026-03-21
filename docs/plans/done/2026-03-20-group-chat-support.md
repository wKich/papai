# Design: Group Chat Support for papai

## Overview

Enable papai bot to work in group chats (Telegram groups, Mattermost channels) with:

- Group-scoped conversation history and configuration
- Group member management separate from bot authorization
- Mention-based responses for natural language queries

## Core Concepts

### Authorization Layers

1. **Bot Admin** - `ADMIN_USER_ID` from env vars, can run `/user` commands globally
2. **Bot User** - Added via `/user add`, can DM the bot
3. **Group Member** - Added via `/group adduser`, can use bot in specific groups
4. **Group Admin** - Platform-level admin, can run `/group` commands

### Context Types

- `dm` - Direct message (contextId = userId, isolated storage)
- `group` - Group chat (contextId = groupId, shared storage among members)

## Authorization Matrix

| Action                   | DM  | Group | Mention Required | Required Permission                  |
| ------------------------ | --- | ----- | ---------------- | ------------------------------------ |
| `/user add/remove <id>`  | ✓   | ✗     | N/A              | Bot Admin                            |
| `/users`                 | ✓   | ✗     | N/A              | Bot Admin                            |
| `/group adduser <@user>` | ✗   | ✓     | No               | Group Admin                          |
| `/group deluser <@user>` | ✗   | ✓     | No               | Group Admin                          |
| `/group users`           | ✗   | ✓     | No               | Any Group Member                     |
| `/set <key> <value>`     | ✓   | ✓     | No               | Bot User (DM) or Group Admin (Group) |
| `/config`                | ✓   | ✓     | No               | Bot User (DM) or Group Admin (Group) |
| `/clear`                 | ✓   | ✓     | No               | Bot User (DM) or Group Admin (Group) |
| `/help`                  | ✓   | ✓     | No               | Bot User (DM) or Group Admin (Group) |
| Natural language         | ✗   | ✓     | Yes              | Group Member only                    |
| Unauthorized mention     | ✗   | ✓     | Yes              | Reply with error message             |

## Database Schema

### New Table: group_members

```sql
CREATE TABLE group_members (
  group_id TEXT NOT NULL,          -- Telegram/Mattermost group/channel ID
  user_id TEXT NOT NULL,           -- Platform user ID
  added_by TEXT NOT NULL,          -- Who added this member
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);
```

## Storage Context

| Context Type | Storage Key | Is Shared | Access Control |
| ------------ | ----------- | --------- | -------------- |
| DM           | `userId`    | No        | Bot User only  |
| Group        | `groupId`   | Yes       | Group Members  |

All storage functions accept `contextId` instead of `userId`:

- Conversation history
- Memory (summary, facts)
- Configuration (`/set` values)
- Workspace ID

## Platform-Specific Details

### Telegram

**Detecting Group vs DM:**

- `ctx.chat?.type`: 'private' (DM), 'group', 'supergroup', 'channel'
- `ctx.chat?.id`: Group ID (negative number for groups)

**Detecting Group Admin:**

- Use `ctx.getChat()` to get chat info
- Call `bot.api.getChatAdministrators(ctx.chat.id)`
- Check if `ctx.from?.id` is in admin list

**Mention Detection:**

- Check `ctx.message?.entities` for `mention` or `text_mention` types
- Match against bot's username (`@botname`)
- Alternative: Check if `ctx.message?.text` contains `@botname`

**Getting Bot Username:**

- Call `bot.api.getMe()` to get bot info including username
- Store for mention detection

### Mattermost

**Detecting Group vs DM:**

- WebSocket event includes `channel_id`
- Channel info via `/api/v4/channels/{channel_id}` returns `type` field
- Types: 'D' (direct), 'G' (group DM), 'O' (public), 'P' (private)

**Detecting Group Admin:**

- Call `/api/v4/channels/{channel_id}/members`
- Find member with matching user_id
- Check `roles` field for 'channel_admin' or system admin

**Mention Detection:**

- Check `post.message` for `@botname`
- Get bot username from user profile data

## Implementation Components

### 1. Updated Type Definitions

```typescript
// src/chat/types.ts
export type ChatUser = {
  id: string
  username: string | null
  isAdmin: boolean // platform admin in current context
}

export type ContextType = 'dm' | 'group'

export type IncomingMessage = {
  user: ChatUser // message sender (for auth)
  contextId: string // storage key: userId in DMs, groupId in groups
  contextType: ContextType
  text: string
  commandMatch?: string
  isMentioned: boolean // bot was mentioned in message
}
```

### 2. New Module: src/groups.ts

```typescript
// Add/remove group members
export function addGroupMember(groupId: string, userId: string, addedBy: string): void
export function removeGroupMember(groupId: string, userId: string): void

// Check membership
export function isGroupMember(groupId: string, userId: string): boolean

// List members
export function listGroupMembers(groupId: string): Array<{ user_id: string; added_at: string; added_by: string }>

// Check if user is group admin (platform-level)
export function isGroupAdmin(groupId: string, userId: string): Promise<boolean>
```

### 3. Platform Provider Updates

**Telegram Provider:**

- Store bot username after initialization
- Detect chat type and set `contextType`
- Extract `contextId` (chat.id)
- Detect if sender is admin
- Detect if bot is mentioned

**Mattermost Provider:**

- Store bot username from user profile
- Parse channel type from WebSocket events
- Extract `contextId` (channel_id)
- Check admin status via API
- Detect mentions in message text

### 4. Authorization Logic

```typescript
// src/bot.ts - Updated checkAuthorization
type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
}

function checkAuthorization(
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  isPlatformAdmin: boolean,
): AuthorizationResult {
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
  if (username && resolveUserByUsername(userId, username)) {
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

### 5. Command Registration

Commands need access to authorization result to enforce permissions:

```typescript
// src/commands/group.ts
export function registerGroupCommands(chat: ChatProvider): void {
  chat.registerCommand('group', async (msg, reply, auth) => {
    if (msg.contextType !== 'group') {
      await reply.text('Group commands can only be used in group chats.')
      return
    }

    if (!auth.isGroupAdmin) {
      await reply.text('Only group admins can manage group members.')
      return
    }

    // Parse subcommand...
  })
}
```

### 6. Message Handler Logic

```typescript
// In chat provider's message handler
const auth = checkAuthorization(userId, username, contextId, contextType, isAdmin)

if (!auth.allowed) {
  if (msg.isMentioned) {
    await reply.text(
      "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
    )
  }
  return
}

// Check mention requirement for natural language
if (msg.contextType === 'group' && !msg.commandMatch && !msg.isMentioned) {
  return // Natural language requires mention
}

// Process with auth.storageContextId
await processMessage(reply, auth.storageContextId, msg.user.username, msg.text)
```

## User Flow Examples

### Scenario 1: Group Setup

1. **Admin** adds bot to Telegram group
2. **Admin** runs `/group adduser @alice` - Alice added to group_members
3. **Admin** runs `/group adduser @bob` - Bob added to group_members
4. **Admin** runs `/set provider kaneo` - Sets group config (group admin only)
5. **Alice** mentions: "@papai create task: review PR" → Task created
6. **Bob** mentions: "@papai show task 123" → Sees same task
7. **Charlie** (not in group_members) mentions: "@papai help" → Gets auth error

### Scenario 2: Unauthorized Mention

1. **Dave** (not in group_members) mentions: "@papai what's the weather"
2. Bot replies: "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @dave`"
3. **Dave** cannot use bot until added by admin

### Scenario 3: Commands Without Mention

1. **Admin** (group admin) runs `/config` (no mention needed, admin only)
2. **Admin** runs `/set provider kaneo` (no mention needed, admin only)
3. **Admin** runs `/group users` (no mention needed, any member)
4. **Alice** (group member) tries `/config` → Gets "Only group admins can run this command"
5. **Alice** mentions: "@papai create task: fix bug" (mention required, member can do this)

## Testing Considerations

1. **Unit Tests:**
   - Authorization logic with different combinations
   - Group membership CRUD operations
   - Mention detection regex

2. **E2E Tests:**
   - Group creation and member management
   - Cross-member conversation continuity
   - Config isolation between groups

3. **Edge Cases:**
   - User added to multiple groups (separate contexts)
   - Group member removed (loses access)
   - Bot removed from group (cleanup?)
   - Platform admin changes (re-check on each message)

## Migration Path

1. Add `group_members` table migration
2. Update `IncomingMessage` type (breaking change for handlers)
3. Update platform providers to detect context and mentions
4. Update authorization logic
5. Add group commands module
6. Update storage layer to use `contextId`
7. Test all commands in both DM and group contexts

## Success Criteria

- [ ] Bot works in Telegram groups
- [ ] Bot works in Mattermost channels
- [ ] Group members can share conversation history
- [ ] Group config is shared among members
- [ ] Only group admins can add/remove members
- [ ] Unauthorized users get clear error message on mention
- [ ] Commands work without mention in groups
- [ ] Natural language requires mention in groups
