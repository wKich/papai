import type { MessageEntity } from '@grammyjs/types/message.js'
import { Bot, type Context } from 'grammy'

import { getThreadScopedStorageContextId } from '../../auth.js'
import { logger } from '../../logger.js'
import { cacheMessage } from '../../message-cache/index.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextType,
  IncomingFile,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ReplyOptions,
  ResolveUserContext,
} from '../types.js'
import { extractFilesFromContext, type TelegramFileFetcher } from './file-helpers.js'
import { formatLlmOutput } from './format.js'
import { createForumTopicIfNeeded } from './forum-topic-helpers.js'
import { buildTelegramInteraction } from './interaction-helpers.js'
import { telegramCapabilities, telegramConfigRequirements, telegramTraits } from './metadata.js'
import { extractReplyContext } from './reply-context-helpers.js'
import {
  createReplyParamsBuilder,
  sendButtonReply,
  sendFileReply,
  sendFormattedReply,
  sendTextReply,
} from './reply-helpers.js'
export { extractReplyContext } from './reply-context-helpers.js'

const log = logger.child({ scope: 'chat:telegram' })

export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  readonly threadCapabilities = {
    supportsThreads: true,
    canCreateThreads: true,
    threadScope: 'message' as const,
  }
  readonly capabilities = telegramCapabilities
  readonly traits = telegramTraits
  readonly configRequirements = telegramConfigRequirements
  private readonly bot: Bot
  private botUsername: string | null = null
  private interactionHandler?: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>

  constructor() {
    const token = process.env['TELEGRAM_BOT_TOKEN']
    if (token === undefined || token.trim() === '') {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required')
    }
    this.bot = new Bot(token)
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.bot.command(name, async (ctx) => {
      const isAdmin = await this.checkAdminStatus(ctx)
      const msg = await this.extractMessage(ctx, isAdmin)
      if (msg === null) return
      msg.commandMatch = typeof ctx.match === 'string' ? ctx.match : ''
      const reply = this.buildReplyFn(ctx, msg.threadId)
      const auth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: isAdmin,
        isGroupAdmin: isAdmin,
        storageContextId: getThreadScopedStorageContextId(msg.contextId, msg.contextType, msg.threadId),
      }
      await handler(msg, reply, auth)
    })
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.bot.on('message:text', async (ctx) => {
      const isAdmin = await this.checkAdminStatus(ctx)
      const msg = await this.extractMessage(ctx, isAdmin)
      if (msg === null) return
      const reply = this.buildReplyFn(ctx, msg.threadId)
      await this.withTypingIndicator(ctx, () => handler(msg, reply))
    })

    this.bot.on(
      ['message:document', 'message:photo', 'message:audio', 'message:video', 'message:voice'],
      async (ctx) => {
        const isAdmin = await this.checkAdminStatus(ctx)
        const msg = await this.extractMessage(ctx, isAdmin)
        if (msg === null) return
        const files = await this.fetchFilesFromContext(ctx)
        if (files.length > 0) msg.files = files
        const reply = this.buildReplyFn(ctx, msg.threadId)
        await this.withTypingIndicator(ctx, () => handler(msg, reply))
      },
    )
  }

  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
  }

  async sendMessage(userId: string, markdown: string): Promise<void> {
    const formatted = formatLlmOutput(markdown)
    await this.bot.api.sendMessage(parseInt(userId, 10), formatted.text, { entities: formatted.entities })
  }

  start(): Promise<void> {
    this.bot.on('callback_query:data', (ctx) => this.dispatchCallbackQuery(ctx))
    return new Promise<void>((resolve, reject) => {
      this.bot
        .start({
          onStart: (botInfo) => {
            this.botUsername = botInfo.username
            log.info({ botUsername: this.botUsername }, 'Telegram bot is running')
            resolve()
          },
        })
        .catch((error: unknown) => {
          const err = error instanceof Error ? error : new Error(String(error))
          log.error({ error: err.message }, 'Telegram polling loop exited')
          reject(err)
        })
    })
  }

  async stop(): Promise<void> {
    await this.bot.stop()
  }

  resolveUserId(username: string, _context: ResolveUserContext): Promise<string | null> {
    const clean = username.startsWith('@') ? username.slice(1) : username
    return Promise.resolve(/^\d+$/.test(clean) ? clean : null)
  }

  async setCommands(adminUserId: string): Promise<void> {
    const userCmds = [
      { command: 'help', description: 'Show available commands' },
      { command: 'setup', description: 'Interactive configuration wizard' },
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
    await this.bot.api.setMyCommands(adminCmds, { scope: { type: 'chat', chat_id: parseInt(adminUserId, 10) } })
    log.info({ adminUserId }, 'Telegram command menu registered')
  }

  private async extractMessage(ctx: Context, isAdmin: boolean): Promise<IncomingMessage | null> {
    const id = ctx.from?.id
    if (id === undefined) return null

    const chatType = ctx.chat?.type
    const isGroup = chatType === 'group' || chatType === 'supergroup' || chatType === 'channel'
    const contextId = String(ctx.chat?.id ?? id)
    const contextType: ContextType = isGroup ? 'group' : 'dm'
    const text = ctx.message?.text ?? ctx.message?.caption ?? ''
    const entities = ctx.message?.entities ?? ctx.message?.caption_entities
    const isMentioned = this.isBotMentioned(text, entities)

    const messageId = ctx.message?.message_id
    const messageIdStr = messageId === undefined ? undefined : String(messageId)
    const replyToMessageId = ctx.message?.reply_to_message?.message_id
    const replyToMessageIdStr = replyToMessageId === undefined ? undefined : String(replyToMessageId)

    if (messageIdStr !== undefined) {
      cacheMessage({
        messageId: messageIdStr,
        contextId,
        authorId: String(id),
        authorUsername: ctx.from?.username ?? undefined,
        text,
        replyToMessageId: replyToMessageIdStr,
        timestamp: Date.now(),
      })
    }

    const replyContext = extractReplyContext(ctx, contextId)
    const threadId = await this.resolveThreadId(ctx, isMentioned, contextType)

    return {
      user: { id: String(id), username: ctx.from?.username ?? null, isAdmin },
      contextId,
      contextType,
      isMentioned,
      text,
      messageId: messageIdStr,
      replyToMessageId: replyToMessageIdStr,
      replyContext,
      threadId,
    }
  }

  private resolveThreadId(
    ctx: Context,
    isMentioned: boolean,
    contextType: ContextType,
  ): Promise<string | undefined> | string | undefined {
    if (isMentioned && contextType === 'group') {
      return createForumTopicIfNeeded(ctx, this.bot.api)
    }
    if (ctx.message?.message_thread_id !== undefined) {
      return String(ctx.message.message_thread_id)
    }
    return undefined
  }
  /** Fetch all attached files from a grammy Context, downloading their content. */
  private fetchFilesFromContext(ctx: Context): Promise<IncomingFile[]> {
    const token = process.env['TELEGRAM_BOT_TOKEN'] ?? ''
    const fetcher: TelegramFileFetcher = async (fileId: string) => {
      try {
        const fileInfo = await this.bot.api.getFile(fileId)
        if (fileInfo.file_path === undefined) return null
        const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`
        const response = await fetch(url)
        if (!response.ok) {
          log.warn({ fileId, status: response.status }, 'Telegram file download failed')
          return null
        }
        return Buffer.from(await response.arrayBuffer())
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        log.error({ fileId, error: errMsg }, 'Failed to fetch Telegram file')
        return null
      }
    }
    return extractFilesFromContext(ctx, fetcher)
  }

  private isBotMentioned(text: string, entities?: MessageEntity[]): boolean {
    if (this.botUsername === null) return false
    if (text.includes(`@${this.botUsername}`)) return true
    return (entities ?? []).some(
      (e) => e.type === 'mention' && text.slice(e.offset, e.offset + e.length) === `@${this.botUsername}`,
    )
  }

  private async checkAdminStatus(ctx: Context): Promise<boolean> {
    if (ctx.chat?.type === 'private') return true
    if (ctx.chat?.id === undefined) return false
    try {
      const admins = await this.bot.api.getChatAdministrators(ctx.chat.id)
      return admins.some((admin) => admin.user.id === ctx.from?.id)
    } catch {
      return false
    }
  }

  private buildReplyFn(ctx: Context, threadId?: string): ReplyFn {
    const chatId = ctx.chat?.id
    const messageId = ctx.message?.message_id
    const buildReplyParams = createReplyParamsBuilder(ctx, threadId)

    return {
      text: (content: string, options?: ReplyOptions) => sendTextReply(ctx, content, buildReplyParams, options),
      formatted: (markdown: string, options?: ReplyOptions) =>
        sendFormattedReply(ctx, markdown, buildReplyParams, options),
      file: (file, options?: ReplyOptions) => sendFileReply(ctx, file, buildReplyParams, options),
      typing: () => void ctx.replyWithChatAction('typing').catch(() => undefined),
      redactMessage: async (replacementText: string) => {
        if (chatId !== undefined && messageId !== undefined) {
          await this.bot.api.editMessageText(chatId, messageId, replacementText).catch((err: unknown) => {
            log.warn(
              { chatId, messageId, error: err instanceof Error ? err.message : String(err) },
              'Failed to redact message',
            )
          })
        }
      },
      buttons: (content: string, options) => sendButtonReply(ctx, content, buildReplyParams, options),
    }
  }

  private async withTypingIndicator<T>(ctx: Context, fn: () => Promise<T>): Promise<T> {
    const send = (): void => void ctx.replyWithChatAction('typing').catch(() => undefined)
    send()
    const interval = setInterval(send, 4500)
    try {
      return await fn()
    } finally {
      clearInterval(interval)
    }
  }
  private async dispatchCallbackQuery(ctx: Context): Promise<void> {
    await ctx.answerCallbackQuery()
    const interaction = buildTelegramInteraction(ctx, await this.checkAdminStatus(ctx))
    if (interaction === null) return
    const reply = this.buildReplyFn(ctx, interaction.threadId)
    if (this.interactionHandler === undefined) {
      log.warn({ callbackData: ctx.callbackQuery?.data }, 'No interaction handler registered')
      return
    }
    await this.interactionHandler(interaction, reply)
  }
}
