import { Bot, InputFile, type Context } from 'grammy'

import { logger } from '../../logger.js'
import type { ChatProvider, CommandHandler, IncomingMessage, ReplyFn } from '../types.js'
import { formatLlmOutput } from './format.js'

const log = logger.child({ scope: 'chat:telegram' })

export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  private readonly bot: Bot

  constructor() {
    const token = process.env['TELEGRAM_BOT_TOKEN']
    if (token === undefined || token.trim() === '') {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required')
    }
    this.bot = new Bot(token)
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.bot.command(name, async (ctx) => {
      const msg = this.extractMessage(ctx)
      if (msg === null) return
      msg.commandMatch = typeof ctx.match === 'string' ? ctx.match : ''
      const reply = this.buildReplyFn(ctx)
      await handler(msg, reply)
    })
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.bot.on('message:text', async (ctx) => {
      const msg = this.extractMessage(ctx)
      if (msg === null) return
      const reply = this.buildReplyFn(ctx)
      await this.withTypingIndicator(ctx, () => handler(msg, reply))
    })
  }

  async sendMessage(userId: string, markdown: string): Promise<void> {
    const formatted = formatLlmOutput(markdown)
    await this.bot.api.sendMessage(parseInt(userId, 10), formatted.text, {
      entities: formatted.entities,
    })
  }

  async start(): Promise<void> {
    await this.bot.start({
      onStart: () => {
        log.info('Telegram bot is running')
      },
    })
  }

  async stop(): Promise<void> {
    await this.bot.stop()
  }

  async setCommands(adminUserId: string): Promise<void> {
    const userCmds = [
      { command: 'help', description: 'Show available commands' },
      { command: 'set', description: 'Set a config value — /set <key> <value>' },
      { command: 'config', description: 'View current configuration' },
      { command: 'clear', description: 'Clear conversation history and memory' },
    ]
    const adminCmds = [
      ...userCmds,
      { command: 'context', description: 'Show current memory context' },
      { command: 'user', description: 'Manage users — /user add|remove <id|@username>' },
      { command: 'users', description: 'List authorized users' },
    ]
    await this.bot.api.setMyCommands(userCmds, { scope: { type: 'all_private_chats' } })
    await this.bot.api.setMyCommands(adminCmds, {
      scope: { type: 'chat', chat_id: parseInt(adminUserId, 10) },
    })
    log.info({ adminUserId }, 'Telegram command menu registered')
  }

  private extractMessage(ctx: Context): IncomingMessage | null {
    const id = ctx.from?.id
    if (id === undefined) return null
    return {
      user: {
        id: String(id),
        username: ctx.from?.username ?? null,
      },
      text: ctx.message?.text ?? '',
    }
  }

  private buildReplyFn(ctx: Context): ReplyFn {
    return {
      text: async (content: string) => {
        await ctx.reply(content)
      },
      formatted: async (markdown: string) => {
        const formatted = formatLlmOutput(markdown)
        await ctx.reply(formatted.text, { entities: formatted.entities })
      },
      file: async (file) => {
        const content = typeof file.content === 'string' ? Buffer.from(file.content, 'utf-8') : file.content
        await ctx.replyWithDocument(new InputFile(content, file.filename))
      },
      typing: () => {
        ctx.replyWithChatAction('typing').catch(() => undefined)
      },
    }
  }

  private async withTypingIndicator<T>(ctx: Context, fn: () => Promise<T>): Promise<T> {
    const send = (): void => {
      ctx.replyWithChatAction('typing').catch(() => undefined)
    }
    send()
    const interval = setInterval(send, 4500)
    try {
      return await fn()
    } finally {
      clearInterval(interval)
    }
  }
}
