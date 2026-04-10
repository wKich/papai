import { logger } from '../../logger.js'
import type {
  ChatProvider,
  CommandHandler,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from '../types.js'
import { type DiscordMessageLike, mapDiscordMessage } from './map-message.js'
import { buildDiscordReplyContext } from './reply-context.js'
import { type SendableChannel, createDiscordReplyFn } from './reply-helpers.js'
import { withTypingIndicator } from './typing-indicator.js'

const log = logger.child({ scope: 'chat:discord' })

type OnMessageHandler = (msg: IncomingMessage, reply: ReplyFn) => Promise<void>

type DispatchableMessage = DiscordMessageLike & {
  channel: SendableChannel & {
    messages?: {
      fetch: (id: string) => Promise<{ id: string; author: { id: string; username: string }; content: string }>
    }
  }
}

export class DiscordChatProvider implements ChatProvider {
  readonly name = 'discord'
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: false,
    canCreateThreads: false,
    threadScope: 'message',
  }
  private readonly token: string
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: OnMessageHandler | null = null
  private client: { destroy: () => Promise<void> } | null = null

  constructor() {
    const token = process.env['DISCORD_BOT_TOKEN']
    if (token === undefined || token.trim() === '') {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required')
    }
    this.token = token
    log.debug({ tokenLength: this.token.length }, 'DiscordChatProvider constructed')
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
    log.debug({ command: name }, 'Discord command registered')
  }

  onMessage(handler: OnMessageHandler): void {
    this.messageHandler = handler
  }

  sendMessage(_userId: string, _markdown: string): Promise<void> {
    return Promise.reject(new Error('DiscordChatProvider.sendMessage not implemented yet'))
  }

  resolveUserId(_username: string, _context: ResolveUserContext): Promise<string | null> {
    return Promise.resolve(null)
  }

  start(): Promise<void> {
    return Promise.reject(new Error('DiscordChatProvider.start not implemented yet'))
  }

  async stop(): Promise<void> {
    if (this.client === null) return
    await this.client.destroy()
    this.client = null
  }

  /** Test-only: inject a stub client for stop() testing. */
  testSetClient(c: { destroy: () => Promise<void> }): void {
    this.client = c
  }

  /** Test-only: simulate inbound messageCreate without a live Client. */
  async testDispatchMessage(message: DispatchableMessage, botId: string, adminUserId: string): Promise<void> {
    await this.dispatchMessage(message, botId, adminUserId)
  }

  private async dispatchMessage(message: DispatchableMessage, botId: string, adminUserId: string): Promise<void> {
    const mapped = mapDiscordMessage(message, botId, adminUserId)
    if (mapped === null) return

    const reply = createDiscordReplyFn({
      channel: message.channel,
      replyToMessageId: mapped.messageId,
    })

    const command = this.matchCommand(mapped.text)
    if (command !== null) {
      mapped.commandMatch = command.match
      await command.handler(mapped, reply, {
        allowed: true,
        isBotAdmin: mapped.user.isAdmin,
        isGroupAdmin: mapped.user.isAdmin,
        storageContextId: mapped.contextId,
      })
      return
    }

    if (this.messageHandler !== null) {
      if (message.channel.messages !== undefined) {
        mapped.replyContext = await buildDiscordReplyContext(
          { reference: message.reference, channel: { id: message.channel.id, messages: message.channel.messages } },
          mapped.contextId,
        )
      }
      await withTypingIndicator(message.channel, () => this.messageHandler!(mapped, reply))
    }
  }

  private matchCommand(text: string): { handler: CommandHandler; match: string } | null {
    const trimmed = text.trim()
    if (!trimmed.startsWith('/')) return null
    for (const [name, handler] of this.commands) {
      if (trimmed === `/${name}` || trimmed.startsWith(`/${name} `)) {
        const match = trimmed.slice(name.length + 2).trim()
        return { handler, match }
      }
    }
    return null
  }
}
