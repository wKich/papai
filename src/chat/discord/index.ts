import { logger } from '../../logger.js'
import type {
  ChatProvider,
  CommandHandler,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from '../types.js'

const log = logger.child({ scope: 'chat:discord' })

export class DiscordChatProvider implements ChatProvider {
  readonly name = 'discord'
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: false,
    canCreateThreads: false,
    threadScope: 'message',
  }
  private readonly token: string

  constructor() {
    const token = process.env['DISCORD_BOT_TOKEN']
    if (token === undefined || token.trim() === '') {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required')
    }
    this.token = token
    log.debug({ tokenLength: this.token.length }, 'DiscordChatProvider constructed')
  }

  registerCommand(_name: string, _handler: CommandHandler): void {
    throw new Error('DiscordChatProvider.registerCommand not implemented yet')
  }

  onMessage(_handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    throw new Error('DiscordChatProvider.onMessage not implemented yet')
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

  stop(): Promise<void> {
    return Promise.resolve()
  }
}
