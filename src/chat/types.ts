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

/** Context about a message reply or quote. */
export type ReplyContext = {
  /** Platform-specific ID of the message being replied to */
  messageId: string
  /** User ID of the original message author (if available) */
  authorId?: string
  /** Username of the original message author (if available) */
  authorUsername?: string | null
  /** Text content of the message being replied to (if available) */
  text?: string
  /** For quote-style replies, the specific quoted text */
  quotedText?: string
  /** Platform-specific thread/topic ID (Telegram: message_thread_id, Mattermost: root_id) */
  threadId?: string
  /** Full reply chain message IDs in chronological order (oldest first) */
  chain?: string[]
  /** Summary of earlier messages in the chain (excludes immediate parent) */
  chainSummary?: string
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
  /** Reply or quote context if this message is a reply */
  replyContext?: ReplyContext
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

/** Options for reply functions to control threading behavior. */
export type ReplyOptions = {
  /** Reply to this specific message ID */
  replyToMessageId?: string
  /** Post in this thread/topic */
  threadId?: string
}

/** Button for interactive messages */
export interface ChatButton {
  text: string
  callbackData: string
  style?: 'primary' | 'secondary' | 'danger'
}

/** Extended reply options with buttons */
export interface ButtonReplyOptions extends ReplyOptions {
  buttons?: ChatButton[]
}

/** Reply function injected into handlers — the only way to send messages back to the user. */
export type ReplyFn = {
  text: (content: string, options?: ReplyOptions) => Promise<void>
  formatted: (markdown: string, options?: ReplyOptions) => Promise<void>
  file: (file: ChatFile, options?: ReplyOptions) => Promise<void>
  typing: () => void
  redactMessage?: (replacementText: string) => Promise<void>
  buttons: (content: string, options: ButtonReplyOptions) => Promise<void>
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
