import pLimit from 'p-limit'

import { logger } from '../../logger.js'
import type { ButtonReplyOptions, ReplyFn, ReplyOptions } from '../types.js'
import { toActionRows } from './buttons.js'
import { chunkForDiscord } from './format-chunking.js'
import { formatLlmOutput } from './format.js'
import { discordTraits } from './metadata.js'

const log = logger.child({ scope: 'chat:discord:reply' })

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

async function sendChunksSequentially(
  channel: SendableChannel,
  chunks: string[],
  replyToMessageId: string | undefined,
  options?: ReplyOptions,
): Promise<BotMessage[]> {
  // Chunks must be sent sequentially to preserve message ordering.
  // Use p-limit with concurrency=1 to enforce sequential execution without await-in-loop.
  const limit = pLimit(1)
  const sent: BotMessage[] = []

  await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const msg = await channel.send({ content: chunk, reply: buildReply(replyToMessageId, options) })
        sent.push(msg)
      }),
    ),
  )

  return sent
}

export function createDiscordReplyFn(params: CreateDiscordReplyFnParams): ReplyFn {
  const { channel, replyToMessageId } = params
  const sentMessages: BotMessage[] = []

  return {
    text: async (content: string, options?: ReplyOptions): Promise<void> => {
      const chunks = chunkForDiscord(content, discordTraits.maxMessageLength!)
      const messages = await sendChunksSequentially(channel, chunks, replyToMessageId, options)
      sentMessages.push(...messages)
    },
    formatted: async (markdown: string, options?: ReplyOptions): Promise<void> => {
      const chunks = formatLlmOutput(markdown)
      const messages = await sendChunksSequentially(channel, chunks, replyToMessageId, options)
      sentMessages.push(...messages)
    },

    typing: (): void => {
      channel.sendTyping().catch(() => undefined)
    },
    redactMessage: async (replacementText: string): Promise<void> => {
      if (sentMessages.length === 0) return
      const results = await Promise.allSettled(
        sentMessages.map((msg) => msg.edit({ content: replacementText, components: [] })),
      )
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failures.length > 0) {
        log.warn({ channelId: channel.id, failureCount: failures.length }, 'Failed to redact some Discord messages')
      }
    },
    buttons: async (content: string, options: ButtonReplyOptions): Promise<void> => {
      const rows = options.buttons === undefined ? [] : toActionRows(options.buttons)
      const sent = await channel.send({ content, components: rows, reply: buildReply(replyToMessageId, options) })
      sentMessages.push(sent)
    },
  }
}
