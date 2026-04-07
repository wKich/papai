import type { MessageEntity } from '@grammyjs/types/message.js'
import { Bot, type Context } from 'grammy'

import { logger } from '../../logger.js'
import { cacheMessage } from '../../message-cache/index.js'
import { buildReplyContextChain } from '../../reply-context.js'
import { handleWizardCallback } from '../../wizard/telegram-handlers.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextType,
  IncomingMessage,
  ReplyContext,
  ReplyFn,
  ReplyOptions,
} from '../types.js'
import { handleConfigEditorCallback } from './config-editor-callbacks.js'
import { formatLlmOutput } from './format.js'
import {
  createReplyParamsBuilder,
  sendButtonReply,
  sendFileReply,
  sendFormattedReply,
  sendTextReply,
} from './reply-helpers.js'

const log = logger.child({ scope: 'chat:telegram' })

/** Minimal interface for extractReplyContext input. Matches grammy Context structure. */
interface ExtractReplyContextInput {
  message?: {
    message_id?: number
    text?: string
    message_thread_id?: number
    reply_to_message?: {
      message_id?: number
      from?: { id?: number; username?: string } | undefined
      text?: string
    }
    quote?: { text?: string }
  }
}

/** Extract reply context from a Telegram message. Exported for testing. */
export function extractReplyContext(ctx: ExtractReplyContextInput, contextId: string): ReplyContext | undefined {
  const replyToMessage = ctx.message?.reply_to_message
  const replyToMessageId = replyToMessage?.message_id
  if (replyToMessage === undefined || replyToMessageId === undefined) return undefined

  const idStr = String(replyToMessageId)
  const quote = ctx.message?.quote
  const { chain, chainSummary } = buildReplyContextChain(contextId, idStr)
  const fromId = replyToMessage.from?.id
  const threadId = ctx.message?.message_thread_id

  return {
    messageId: idStr,
    authorId: fromId === undefined ? undefined : String(fromId),
    authorUsername: replyToMessage.from?.username ?? null,
    text: replyToMessage.text,
    quotedText: quote?.text,
    threadId: threadId === undefined ? undefined : String(threadId),
    chain,
    chainSummary,
  }
}

export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  private readonly bot: Bot
  private botUsername: string | null = null

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
      const msg = this.extractMessage(ctx, isAdmin)
      if (msg === null) return
      msg.commandMatch = typeof ctx.match === 'string' ? ctx.match : ''
      const reply = this.buildReplyFn(ctx)
      const auth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: isAdmin,
        isGroupAdmin: isAdmin,
        storageContextId: msg.contextId,
      }
      await handler(msg, reply, auth)
    })
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.bot.on('message:text', async (ctx) => {
      const isAdmin = await this.checkAdminStatus(ctx)
      const msg = this.extractMessage(ctx, isAdmin)
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

  start(): Promise<void> {
    this.bot.on('callback_query:data', async (ctx) => {
      // Handle config editor callbacks (new button-based editor)
      if (ctx.callbackQuery.data?.startsWith('cfg:')) {
        const handled = await handleConfigEditorCallback(ctx)
        if (handled) return
      }
      // Handle wizard callbacks
      await handleWizardCallback(ctx)
    })

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

  resolveUserId(username: string): Promise<string | null> {
    // Telegram Bot API cannot resolve usernames to user IDs
    // Only numeric IDs can be used directly
    const cleanUsername = username.startsWith('@') ? username.slice(1) : username
    if (/^\d+$/.test(cleanUsername)) {
      return Promise.resolve(cleanUsername)
    }
    return Promise.resolve(null)
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
    await this.bot.api.setMyCommands(adminCmds, {
      scope: { type: 'chat', chat_id: parseInt(adminUserId, 10) },
    })
    log.info({ adminUserId }, 'Telegram command menu registered')
  }

  private extractMessage(ctx: Context, isAdmin: boolean): IncomingMessage | null {
    const id = ctx.from?.id
    if (id === undefined) return null

    const chatType = ctx.chat?.type
    const isGroup = chatType === 'group' || chatType === 'supergroup' || chatType === 'channel'
    const contextId = String(ctx.chat?.id ?? id)
    const contextType: ContextType = isGroup ? 'group' : 'dm'

    const text = ctx.message?.text ?? ''
    const isMentioned = this.isBotMentioned(text, ctx.message?.entities)

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

    return {
      user: { id: String(id), username: ctx.from?.username ?? null, isAdmin },
      contextId,
      contextType,
      isMentioned,
      text,
      messageId: messageIdStr,
      replyToMessageId: replyToMessageIdStr,
      replyContext,
    }
  }

  private isBotMentioned(text: string, entities?: MessageEntity[]): boolean {
    if (this.botUsername === null) return false
    if (text.includes(`@${this.botUsername}`)) return true

    if (entities !== undefined) {
      for (const entity of entities) {
        if (entity.type === 'mention') {
          const mentionText = text.slice(entity.offset, entity.offset + entity.length)
          if (mentionText === `@${this.botUsername}`) return true
        }
      }
    }

    return false
  }

  private async checkAdminStatus(ctx: Context): Promise<boolean> {
    if (ctx.chat?.type === 'private') return true
    if (ctx.chat?.id === undefined) return false

    try {
      const admins = await this.bot.api.getChatAdministrators(ctx.chat.id)
      const userId = ctx.from?.id
      if (userId === undefined) return false
      return admins.some((admin) => admin.user.id === userId)
    } catch {
      return false
    }
  }

  private buildReplyFn(ctx: Context): ReplyFn {
    const chatId = ctx.chat?.id
    const messageId = ctx.message?.message_id
    const buildReplyParams = createReplyParamsBuilder(ctx)

    return {
      text: (content: string, options?: ReplyOptions) => sendTextReply(ctx, content, buildReplyParams, options),
      formatted: (markdown: string, options?: ReplyOptions) =>
        sendFormattedReply(ctx, markdown, buildReplyParams, options),
      file: (file, options?: ReplyOptions) => sendFileReply(ctx, file, buildReplyParams, options),
      typing: () => {
        ctx.replyWithChatAction('typing').catch(() => undefined)
      },
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
