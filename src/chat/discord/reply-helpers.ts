import pLimit from 'p-limit'

import { logger } from '../../logger.js'
import type { ButtonReplyOptions, EmbedOptions, ReplyFn, ReplyOptions } from '../types.js'
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
    embeds?: unknown[]
    reply?: { messageReference: string; failIfNotExists: boolean }
  }) => Promise<{ id: string; edit: (arg: { content?: string; components?: unknown[] }) => Promise<unknown> }>
  sendTyping: () => Promise<void>
}

export type CreateDiscordReplyFnParams = {
  channel: SendableChannel
  replyToMessageId: string | undefined
  replaceMessage?: BotMessage
}

type MessageRef = { messageReference: string; failIfNotExists: boolean } | undefined

type BotMessage = {
  id: string
  edit: (arg: { content?: string; components?: unknown[] }) => Promise<unknown>
}

type EditPayload = { content?: string; components?: unknown[] }

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

function createEmbedPayload(options: EmbedOptions): Record<string, unknown> {
  const embed: Record<string, unknown> = {
    title: options.title,
    description: options.description,
  }
  if (options.fields !== undefined) {
    embed['fields'] = options.fields
  }
  if (options.footer !== undefined) {
    embed['footer'] = { text: options.footer }
  }
  if (options.color !== undefined) {
    embed['color'] = options.color
  }
  return embed
}

async function sendTextReply(
  channel: SendableChannel,
  sentMessages: BotMessage[],
  replyToMessageId: string | undefined,
  content: string,
  options?: ReplyOptions,
): Promise<void> {
  const chunks = chunkForDiscord(content, discordTraits.maxMessageLength!)
  const messages = await sendChunksSequentially(channel, chunks, replyToMessageId, options)
  sentMessages.push(...messages)
}

async function sendFormattedReply(
  channel: SendableChannel,
  sentMessages: BotMessage[],
  replyToMessageId: string | undefined,
  markdown: string,
  options?: ReplyOptions,
): Promise<void> {
  const chunks = formatLlmOutput(markdown)
  const messages = await sendChunksSequentially(channel, chunks, replyToMessageId, options)
  sentMessages.push(...messages)
}

async function sendButtonsReply(
  channel: SendableChannel,
  sentMessages: BotMessage[],
  replyToMessageId: string | undefined,
  content: string,
  options: ButtonReplyOptions,
): Promise<void> {
  const rows = options.buttons === undefined ? [] : toActionRows(options.buttons)
  const sent = await channel.send({ content, components: rows, reply: buildReply(replyToMessageId, options) })
  sentMessages.push(sent)
}

async function replaceOrSend(
  replaceMessage: BotMessage | undefined,
  payload: EditPayload,
  fallback: () => Promise<void>,
): Promise<void> {
  if (replaceMessage === undefined) {
    await fallback()
    return
  }

  await replaceMessage.edit(payload)
}

async function redactMessages(channelId: string, sentMessages: BotMessage[], replacementText: string): Promise<void> {
  if (sentMessages.length === 0) return

  const results = await Promise.allSettled(
    sentMessages.map((msg) => msg.edit({ content: replacementText, components: [] })),
  )
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    log.warn({ channelId, failureCount: failures.length }, 'Failed to redact some Discord messages')
  }
}

export function createDiscordReplyFn(params: CreateDiscordReplyFnParams): ReplyFn {
  const { channel, replyToMessageId, replaceMessage } = params
  const sentMessages: BotMessage[] = []

  return {
    text: (content: string, options?: ReplyOptions): Promise<void> =>
      sendTextReply(channel, sentMessages, replyToMessageId, content, options),
    replaceText: (content: string, options?: ReplyOptions): Promise<void> =>
      replaceOrSend(replaceMessage, { content, components: [] }, () =>
        sendTextReply(channel, sentMessages, replyToMessageId, content, options),
      ),
    formatted: (markdown: string, options?: ReplyOptions): Promise<void> =>
      sendFormattedReply(channel, sentMessages, replyToMessageId, markdown, options),

    typing: (): void => {
      channel.sendTyping().catch(() => undefined)
    },
    redactMessage: (replacementText: string): Promise<void> =>
      redactMessages(channel.id, sentMessages, replacementText),
    buttons: (content: string, options: ButtonReplyOptions): Promise<void> =>
      sendButtonsReply(channel, sentMessages, replyToMessageId, content, options),
    replaceButtons: (content: string, options: ButtonReplyOptions): Promise<void> =>
      replaceOrSend(
        replaceMessage,
        { content, components: options.buttons === undefined ? [] : toActionRows(options.buttons) },
        () => sendButtonsReply(channel, sentMessages, replyToMessageId, content, options),
      ),
    embed: async (options: EmbedOptions): Promise<void> => {
      const embed = createEmbedPayload(options)
      const sent = await channel.send({ embeds: [embed], reply: buildReply(replyToMessageId, undefined) })
      sentMessages.push(sent)
    },
  }
}
