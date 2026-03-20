/** Identity extracted from an incoming message. */
export type ChatUser = {
  id: string
  username: string | null
  isAdmin: boolean // platform admin in current context
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
  contextId: string // storage key: userId in DMs, groupId in groups
  contextType: ContextType
  isMentioned: boolean // bot was @mentioned
  text: string
  commandMatch?: string
}

/** Authorization result for message processing. */
export type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
}

/** Command handler signature. */
export type CommandHandler = (
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
) => Promise<void>

/** Reply function injected into handlers — the only way to send messages back to the user. */
export type ReplyFn = {
  text: (content: string) => Promise<void>
  formatted: (markdown: string) => Promise<void>
  file: (file: ChatFile) => Promise<void>
  typing: () => void
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
