// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { logger } from '../../logger.js'
import type { ReplyOptions } from '../types.js'
import { formatLlmOutput } from './format.js'
import { telegramTraits } from './metadata.js'

const log = logger.child({ scope: 'chat:telegram:chunking' })

/**
 * Split a string into chunks no longer than `budget`, cutting at the last
 * paragraph break before the budget, else the last line break, else a hard
 * cut at the budget. A hard cut that would split a UTF-16 surrogate pair is
 * nudged one code unit left so an astral character is never orphaned, and
 * leading boundary newlines are trimmed from each remainder before the next
 * split.
 */
export function chunkForTelegram(input: string, budget: number): string[] {
  const chunks: string[] = []
  let remainder = input
  while (remainder.length > budget) {
    const cut = findCutIndex(remainder, budget)
    chunks.push(remainder.slice(0, cut))
    remainder = remainder.slice(cut).replace(/^\n+/u, '')
  }
  if (remainder.length > 0 || chunks.length === 0) {
    chunks.push(remainder)
  }
  return chunks
}

function findCutIndex(text: string, budget: number): number {
  const paragraph = text.lastIndexOf('\n\n', budget)
  if (paragraph > 0) return paragraph

  const line = text.lastIndexOf('\n', budget)
  if (line > 0) return line

  if (splitsSurrogatePair(text, budget)) return Math.max(1, budget - 1)
  return Math.max(1, budget)
}

function splitsSurrogatePair(text: string, cut: number): boolean {
  return isHighSurrogate(text.charCodeAt(cut - 1)) && isLowSurrogate(text.charCodeAt(cut))
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff
}

type FormattedChunk = ReturnType<typeof formatLlmOutput>

type TelegramEntity = FormattedChunk['entities'][number]

type TelegramFormatter = (markdown: string) => FormattedChunk

type TelegramReplyParameters = { message_id: number } & Partial<{ message_thread_id: number }>

/** Narrow reply context the chunked formatted send needs: the reply call plus the chat the warn log identifies. */
export type TelegramChunkSendContext = {
  reply: (text: string, other?: Record<string, unknown>) => Promise<{ message_id: number; chat: { id: number } }>
} & Partial<{ chat: { id: number } }>

/**
 * Split markdown into formatted chunks whose delivered text each fits the Telegram
 * message limit. The whole markdown is formatted first — formatting is not
 * length-preserving, so an over-limit markdown source can still deliver as one
 * message — and only an over-limit delivery is split, at the markdown level, so
 * entity offsets stay per-message. A chunk whose formatted text still exceeds the
 * limit is re-split from its markdown at a proportionally reduced budget (the
 * splitter's hard cut is the floor). `firstChunkReserve` shortens the first
 * chunk's budget by the length of a text prefix the caller prepends to it (the
 * deferred path's mention prefix), so `prefix + first chunk` stays within the
 * limit; followers get the full budget.
 */
export function buildFormattedChunksForTelegram(
  markdown: string,
  format: TelegramFormatter = formatLlmOutput,
  firstChunkReserve = 0,
): FormattedChunk[] {
  const limit = telegramTraits.maxMessageLength!
  const whole = format(markdown)
  if (whole.text.length + firstChunkReserve <= limit) {
    return [whole]
  }
  return splitFormattedChunks(markdown, limit, limit - firstChunkReserve, format, firstChunkReserve)
}

function splitFormattedChunks(
  markdown: string,
  limit: number,
  budget: number,
  format: TelegramFormatter,
  firstChunkReserve = 0,
): FormattedChunk[] {
  const chunks: FormattedChunk[] = []
  let reserve = firstChunkReserve
  for (const piece of chunkForTelegram(markdown, budget)) {
    const formatted = format(piece)
    if (formatted.text.length + reserve <= limit) {
      chunks.push(formatted)
      reserve = 0
      continue
    }
    const reducedBudget = Math.floor((budget * (limit - reserve)) / formatted.text.length)
    chunks.push(...splitFormattedChunks(piece, limit, reducedBudget, format, reserve))
    reserve = 0
  }
  return chunks
}

export async function sendFormattedTelegramChunks(
  ctx: TelegramChunkSendContext,
  markdown: string,
  replyParameters: TelegramReplyParameters | undefined,
  options: ReplyOptions | undefined,
  format: TelegramFormatter = formatLlmOutput,
): Promise<{ messageId: number; chatId: number }> {
  const chunks = buildFormattedChunksForTelegram(markdown, format)
  const chunkCount = chunks.length
  const chatId = ctx.chat === undefined ? undefined : ctx.chat.id
  // Chunks must be sent sequentially to preserve message ordering.
  // Use p-limit with concurrency=1 to enforce sequential execution without await-in-loop.
  const sendOne = pLimit(1)
  const sent: Array<{ messageId: number; chatId: number }> = []
  let firstError: Error | undefined

  await Promise.all(
    chunks.map((chunk, chunkIndex) =>
      sendOne(async () => {
        try {
          const message = await ctx.reply(chunk.text, {
            entities: chunk.entities,
            reply_parameters: replyParameters,
            ...(options?.disableLinkPreview === true ? { link_preview_options: { is_disabled: true } } : {}),
          })
          sent.push({ messageId: message.message_id, chatId: message.chat.id })
        } catch (error) {
          const sendError = error instanceof Error ? error : new Error(String(error))
          firstError ??= sendError
          log.warn({ chatId, chunkIndex, chunkCount, error: sendError.message }, 'Failed to send Telegram reply chunk')
        }
      }),
    ),
  )

  const [firstSent] = sent
  if (firstSent === undefined) {
    throw firstError ?? new Error('Telegram first reply chunk was not sent')
  }
  if (firstError !== undefined) throw firstError
  return firstSent
}

/** Mention prefix the deferred path prepends to the first chunk: text plus its own entities. */
export type DeferredMentionPrefix = {
  readonly text: string
  readonly entities: readonly TelegramEntity[]
}

export type DeferredTelegramSendOptions = { entities: TelegramEntity[]; message_thread_id?: number }

export type DeferredTelegramSend = (text: string, options: DeferredTelegramSendOptions) => Promise<unknown>

/**
 * Send a deferred markdown delivery as formatted chunks through the Bot API's
 * sendMessage. The mention prefix (text and entity-offset shift) lands on the
 * first chunk only, its length counted against that chunk's budget; every chunk
 * carries the same message_thread_id. A failed chunk warns with the chat id and
 * chunk position, later chunks are still attempted, and the first error is
 * rethrown after the loop.
 */
export async function sendDeferredTelegramChunks(
  send: DeferredTelegramSend,
  chatId: number,
  markdown: string,
  mentionPrefix: DeferredMentionPrefix,
  threadId: number | undefined,
  format: TelegramFormatter = formatLlmOutput,
): Promise<void> {
  const chunks = buildFormattedChunksForTelegram(markdown, format, mentionPrefix.text.length)
  const chunkCount = chunks.length
  // Chunks must be sent sequentially to preserve message ordering.
  // Use p-limit with concurrency=1 to enforce sequential execution without await-in-loop.
  const sendOne = pLimit(1)
  let firstError: Error | undefined

  await Promise.all(
    chunks.map((chunk, chunkIndex) =>
      sendOne(async () => {
        const prefixed = chunkIndex === 0
        const options: DeferredTelegramSendOptions = {
          entities: prefixed
            ? [
                ...mentionPrefix.entities,
                ...chunk.entities.map((entity) => ({
                  ...entity,
                  offset: entity.offset + mentionPrefix.text.length,
                })),
              ]
            : chunk.entities,
        }
        if (threadId !== undefined) {
          options.message_thread_id = threadId
        }
        try {
          await send(prefixed ? `${mentionPrefix.text}${chunk.text}` : chunk.text, options)
        } catch (error) {
          const sendError = error instanceof Error ? error : new Error(String(error))
          firstError ??= sendError
          log.warn(
            { chatId, chunkIndex, chunkCount, error: sendError.message },
            'Failed to send Telegram deferred chunk',
          )
        }
      }),
    ),
  )

  if (firstError !== undefined) throw firstError
}
