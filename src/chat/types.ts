/** Identity extracted from an incoming message. */
export type ChatUser = {
  id: string
  username: string | null
  /** platform admin in current context */
  isAdmin: boolean
}

/** Context type for messages - DM or group chat. */
export type ContextType = 'dm' | 'group'

/** A file to send to the user. */
export type ChatFile = {
  content: Buffer | string
  filename: string
}

/** Incoming message from a user. */
export type IncomingMessage = {
  user: ChatUser
  /** storage key: userId in DMs, groupId in groups */
  contextId: string
  contextType: ContextType
  /** bot was @mentioned */
  isMentioned: boolean
  text: string
  commandMatch?: string
  /** platform-specific message ID for deletion */
  messageId?: string
  /** parent message ID if this is a reply */
  replyToMessageId?: string
}

/** Authorization result for message processing. */
export type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
}

/** Command handler signature. */
export type CommandHandler = (msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void>

/** Reply function injected into handlers — the only way to send messages back to the user. */
export type ReplyFn = {
  text: (content: string) => Promise<void>
  formatted: (markdown: string) => Promise<void>
  file: (file: ChatFile) => Promise<void>
  typing: () => void
  redactMessage?: (replacementText: string) => Promise<void>
}

/** The core interface every chat platform provider must implement. */
export interface ChatProvider {
  readonly name: string

  /** Register a slash command handler (e.g., 'help' for /help). */
  registerCommand(name: string, handler: CommandHandler): void

  /** Register the catch-all handler for non-command messages. */
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void

  /** Send a formatted markdown message to a user by ID (for announcements). */
  sendMessage(userId: string, markdown: string): Promise<void>

  /** Start the bot event loop. */
  start(): Promise<void>

  /** Graceful shutdown. */
  stop(): Promise<void>
}
