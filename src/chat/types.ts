/** Identity extracted from an incoming message. */
export type ChatUser = {
  id: string
  username: string | null
}

/** A file to send to the user. */
export type ChatFile = {
  content: Buffer | string
  filename: string
}

/** Incoming message from a user. */
export type IncomingMessage = {
  user: ChatUser
  text: string
  commandMatch?: string
}

/** Command handler signature. */
export type CommandHandler = (msg: IncomingMessage, reply: ReplyFn) => Promise<void>

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
