/** Identity extracted from an incoming message. */
export type ChatUser = {
  id: string
  username: string | null
  /** platform admin in current context */
  isAdmin: boolean
}

/** Context type for messages - DM or group chat. */
export type ContextType = 'dm' | 'group'

/** Context passed to resolveUserId so adapters can scope searches. */
export type ResolveUserContext = {
  /** Storage key of the conversation where the lookup originated (userId in DMs, channel/group ID in groups). */
  contextId: string
  /** 'dm' or 'group' — adapters may use this to decide whether guild-scoped search is possible. */
  contextType: ContextType
}

/** Thread support capabilities for a chat platform. */
export type ThreadCapabilities = {
  /** Platform has thread/topic support */
  supportsThreads: boolean
  /** Bot can create new threads (Telegram: yes, Mattermost: no) */
  canCreateThreads: boolean
  /** Platform-specific thread identifier type */
  threadScope: 'message' | 'post'
}

/** Capability strings for chat platform features. */
export type ChatCapability =
  | 'commands.menu'
  | 'interactions.callbacks'
  | 'messages.buttons'
  | 'messages.files'
  | 'messages.redact'
  | 'messages.reply-context'
  | 'files.receive'
  | 'users.resolve'

/** Behavioral traits for a chat platform. */
export type ChatProviderTraits = {
  /** Whether the bot sees all group messages or only mentions */
  observedGroupMessages: 'all' | 'mentions_only'
  /** Maximum length of a single message (platform limit) */
  maxMessageLength?: number
  /** Maximum length of callback data in button interactions */
  callbackDataMaxLength?: number
}

/** A config key required by this chat provider. */
export type ChatProviderConfigRequirement = {
  key: string
  label: string
  required: boolean
}

/** A file to send to the user. */
export type ChatFile = {
  content: Buffer | string
  filename: string
}

/** An incoming file attached to a user message. */
export type IncomingFile = {
  /** Platform-specific file identifier */
  fileId: string
  /** Human-readable filename */
  filename: string
  /** MIME type (if available) */
  mimeType?: string
  /** File size in bytes (if available) */
  size?: number
  /** Raw file content */
  content: Buffer
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
  /** Files attached to this message (populated by platform adapters) */
  files?: IncomingFile[]
  /** Platform thread ID (if in thread) */
  threadId?: string
}

/** An incoming button interaction from a user. */
export type IncomingInteraction = {
  kind: 'button'
  user: ChatUser
  contextId: string
  contextType: ContextType
  callbackData: string
  /** Platform-specific message ID of the interactive message */
  messageId?: string
  /** Platform thread ID (if in thread) */
  threadId?: string
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
  /** Thread support capabilities */
  readonly threadCapabilities: ThreadCapabilities
  /** Set of supported capability strings */
  readonly capabilities: ReadonlySet<ChatCapability>
  /** Behavioral traits for this platform */
  readonly traits: ChatProviderTraits
  /** Environment/config requirements for startup */
  readonly configRequirements: readonly ChatProviderConfigRequirement[]

  /** Register a slash command handler (e.g., 'help' for /help). */
  registerCommand(name: string, handler: CommandHandler): void

  /** Register the catch-all handler for non-command messages. */
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void

  /** Register the handler for button/callback interactions (optional). */
  onInteraction?(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void

  /** Send a formatted markdown message to a user by ID (for announcements). */
  sendMessage(userId: string, markdown: string): Promise<void>

  /**
   * Resolve a username to a user ID. Returns null if not found or not supported.
   *
   * The `users.resolve` capability signals full username-resolution support (e.g. Mattermost).
   * A provider may still expose a narrower passthrough implementation without advertising that
   * capability — for example, accepting numeric IDs directly while rejecting plain usernames.
   *
   * The `context` parameter lets adapters like Discord scope the lookup to the caller's guild.
   */
  resolveUserId?(username: string, context: ResolveUserContext): Promise<string | null>

  /** Register the bot's command list with the platform (for command menus). */
  setCommands?(adminUserId: string): Promise<void>

  /** Start the bot event loop. */
  start(): Promise<void>

  /** Graceful shutdown. */
  stop(): Promise<void>
}
