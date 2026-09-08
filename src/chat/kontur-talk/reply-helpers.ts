// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { logger } from '../../logger.js'
import type { ButtonReplyOptions, ReplyFn, ReplyOptions } from '../types.js'
import { konturTalkTraits } from './metadata.js'

const log = logger.child({ scope: 'chat:kontur-talk:chunking' })

interface KonturTalkReplyHelpersParams {
  roomId: string
  threadId?: string
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>
}

/**
 * Split a string into chunks no longer than `budget`, cutting at the last
 * paragraph break before the budget, else the last line break, else a hard
 * cut at the budget. A hard cut that would split a UTF-16 surrogate pair is
 * nudged one code unit left so an astral character is never orphaned, and
 * leading boundary newlines are trimmed from each remainder before the next
 * split.
 */
function chunkForKonturTalk(input: string, budget: number): string[] {
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

/** One /send_message call for a single chunk, with the reply's reply options bound. */
type KonturTalkChunkSend = (chunk: string) => Promise<void>

/**
 * Send already-split chunks as sequential /send_message calls through the shared send
 * seam (same room and thread). A failed chunk logs `warn` with the room id and chunk
 * position, later chunks are still attempted, and the first error is rethrown after
 * the loop.
 */
async function sendKonturTalkChunks(
  roomId: string,
  chunks: readonly string[],
  sendChunk: KonturTalkChunkSend,
): Promise<void> {
  const chunkCount = chunks.length
  // Chunks must be sent sequentially to preserve message ordering.
  // Use p-limit with concurrency=1 to enforce sequential execution without await-in-loop.
  const sendOne = pLimit(1)
  let firstError: Error | undefined

  await Promise.all(
    chunks.map((chunk, chunkIndex) =>
      sendOne(async () => {
        try {
          await sendChunk(chunk)
        } catch (error) {
          const sendError = error instanceof Error ? error : new Error(String(error))
          firstError ??= sendError
          log.warn(
            { roomId, chunkIndex, chunkCount, error: sendError.message },
            'Failed to send Kontur Talk reply chunk',
          )
        }
      }),
    ),
  )

  if (firstError !== undefined) throw firstError
}

export function createKonturTalkReplyFn(params: KonturTalkReplyHelpersParams): ReplyFn {
  const { roomId, threadId, apiFetch } = params

  const send = async (message: string, format: string, options?: ReplyOptions): Promise<void> => {
    await apiFetch('POST', '/send_message', {
      room_id: roomId,
      message,
      format,
      thread_id: options?.threadId ?? threadId ?? null,
      mentions: [],
    })
  }

  const sendChunked = (markdown: string, options?: ReplyOptions): Promise<void> =>
    sendKonturTalkChunks(roomId, chunkForKonturTalk(markdown, konturTalkTraits.maxMessageLength!), (chunk) =>
      send(chunk, 'markdown', options),
    )

  return {
    text: (content: string, options?: ReplyOptions) => send(content, 'plain', options),
    formatted: sendChunked,
    typing: () => {
      // no-op: Kontur Talk has no typing indicator API
    },
    buttons: (_content: string, _options: ButtonReplyOptions) => {
      return Promise.reject(new Error('This platform does not support interactive buttons.'))
    },
  }
}
