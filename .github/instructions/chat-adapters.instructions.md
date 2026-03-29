---
applyTo: "src/chat/**"
---

# Chat Adapter Conventions

## Interface

All chat adapters implement `ChatProvider` from `src/chat/types.ts`:

```typescript
interface ChatProvider {
  name: string
  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void
  sendMessage(contextId: string, text: string): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
}
```

## Registration

Adapters register in `src/chat/registry.ts` via `createChatProvider(name)`. Built-in: `telegram`, `mattermost`.

## Rules

- Platform-specific code stays inside the adapter directory (`telegram/`, `mattermost/`)
- Adapters must map platform events to `IncomingMessage` and provide a `ReplyFn`
- `ReplyFn` methods: `text`, `formatted`, `file`, `typing`, `redactMessage`, `buttons`
- No business logic in adapters — they only bridge the platform to the bot layer
- Formatting helpers (e.g. `telegram/format.ts`) convert LLM markdown to platform-native format
