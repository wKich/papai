import { logger } from '../../logger.js'
import type { ButtonReplyOptions, ChatFile, ReplyFn, ReplyOptions } from '../types.js'
import { toActionRows } from './buttons.js'
import { chunkForDiscord } from './format-chunking.js'
import { formatLlmOutput } from './format.js'

const log = logger.child({ scope: 'chat:discord:reply' })
const DISCORD_MAX_CONTENT_LEN = 2000

export type SendableChannel = {
  id: string
  send: (arg: {
    content?: string
    components?: unknown[]
    reply?: { messageReference: string; failIfNotExists: boolean }
  }) => Promise<{ id: string; edit: (arg: { content?: string; components?: unknown[] }) => Promise<unknown> }>
  sendTyping: () => Promise<void>
}

export type CreateDiscordReplyFnParams = {
  channel: SendableChannel
  replyToMessageId: string | undefined
}

type MessageRef = { messageReference: string; failIfNotExists: boolean } | undefined

type BotMessage = {
  id: string
  edit: (arg: { content?: string; components?: unknown[] }) => Promise<unknown>
}

function buildReply(replyToMessageId: string | undefined, options?: ReplyOptions): MessageRef {
  const target = options?.replyToMessageId ?? replyToMessageId
  return target === undefined ? undefined : { messageReference: target, failIfNotExists: false }
}

function sendChunksSequentially(
  channel: SendableChannel,
  chunks: string[],
  replyToMessageId: string | undefined,
  options?: ReplyOptions,
): Promise<BotMessage | null> {
  // Chunks must be sent sequentially to preserve message ordering.
  // Using reduce to chain promises instead of await-in-loop.
  return chunks.reduce<Promise<BotMessage | null>>(
    (prev, chunk) => prev.then(() => channel.send({ content: chunk, reply: buildReply(replyToMessageId, options) })),
    Promise.resolve(null),
  )
}

export function createDiscordReplyFn(params: CreateDiscordReplyFnParams): ReplyFn {
  const { channel, replyToMessageId } = params
  let lastBotMessage: BotMessage | null = null

  return {
    text: async (content: string, options?: ReplyOptions): Promise<void> => {
      const chunks = chunkForDiscord(content, DISCORD_MAX_CONTENT_LEN)
      lastBotMessage = await sendChunksSequentially(channel, chunks, replyToMessageId, options)
    },
    formatted: async (markdown: string, options?: ReplyOptions): Promise<void> => {
      const chunks = formatLlmOutput(markdown)
      lastBotMessage = await sendChunksSequentially(channel, chunks, replyToMessageId, options)
    },
    file: (_file: ChatFile, _options?: ReplyOptions): Promise<void> => {
      return Promise.reject(new Error('Discord file send not implemented — deferred'))
    },
    typing: (): void => {
      channel.sendTyping().catch(() => undefined)
    },
    redactMessage: async (replacementText: string): Promise<void> => {
      if (lastBotMessage === null) return
      try {
        await lastBotMessage.edit({ content: replacementText, components: [] })
      } catch (error) {
        log.warn(
          { channelId: channel.id, error: error instanceof Error ? error.message : String(error) },
          'Failed to redact Discord message',
        )
      }
    },
    buttons: async (content: string, options: ButtonReplyOptions): Promise<void> => {
      const rows = options.buttons === undefined ? [] : toActionRows(options.buttons)
      const sent = await channel.send({ content, components: rows, reply: buildReply(replyToMessageId, options) })
      lastBotMessage = sent
    },
  }
}
