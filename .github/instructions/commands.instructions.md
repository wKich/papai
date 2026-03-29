---
applyTo: 'src/commands/**'
---

# Command Handler Conventions

## Pattern

Commands are platform-agnostic handlers registered via `ChatProvider.registerCommand()`:

```typescript
export function registerXCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return // Early auth check — always first
    // Command logic...
    await reply.text('Response')
  }
  chat.registerCommand('commandname', handler)
}
```

## Rules

- **Auth check first**: Always check `auth.allowed` before any logic
- **No platform imports**: Command handlers must not import Telegram, Mattermost, or any platform-specific code
- **Use injected `reply`**: Send responses via `reply.text()`, `reply.formatted()`, `reply.buttons()`, `reply.file()` — never platform APIs directly
- **Admin commands**: Check `auth.isBotAdmin` for admin-only commands
- **Group context**: Check `msg.contextType` and `auth.isGroupAdmin` for group-specific behavior
- **Message data**: Access user info via `msg.user` (`{ id, username, isAdmin }`), context via `msg.contextId` and `msg.contextType`

## Types

- `CommandHandler`: `(msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void>`
- `IncomingMessage`: `{ user: ChatUser, contextId: string, contextType: 'dm' | 'group', text: string, commandMatch: string, ... }`
- `ReplyFn`: `{ text, formatted, file, typing, redactMessage, buttons }`

## Registration

Commands are registered in `src/bot.ts` via `setupBot(chat, adminUserId)`. Add new command registrations there.
