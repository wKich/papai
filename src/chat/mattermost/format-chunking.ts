// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { logger } from '../../logger.js'
import type { ReplyOptions } from '../types.js'
import { mattermostTraits } from './metadata.js'

const log = logger.child({ scope: 'chat:mattermost:chunking' })

/**
 * Split a string into chunks no longer than `budget`, cutting at the last
 * paragraph break before the budget, else the last line break, else a hard
 * cut at the budget. A hard cut that would split a UTF-16 surrogate pair is
 * nudged one code unit left so an astral character is never orphaned, and
 * leading boundary newlines are trimmed from each remainder before the next
 * split.
 */
export function chunkForMattermost(input: string, budget: number): string[] {
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

/** Post seam shared with `makePost`: same channel/thread, resolves to the created post id. */
export type MattermostChunkPost = (message: string, options?: ReplyOptions) => Promise<string | undefined>

/**
 * Send a formatted reply as ordered chunks through the Mattermost post API.
 * Mattermost posts markdown verbatim, so the markdown is split directly at
 * the adapter's declared message limit, and every chunk goes through the same
 * post seam (same channel/thread). Resolves with the first chunk's post id —
 * the `lastReplyTarget` snapshot — after every chunk was attempted: a failed
 * chunk logs `warn` with the channel id and chunk position, later chunks are
 * still attempted, and the first error is rethrown after the loop.
 */
export async function sendMattermostFormattedChunks(
  channelId: string,
  post: MattermostChunkPost,
  markdown: string,
  options: ReplyOptions | undefined,
): Promise<string | undefined> {
  const chunks = chunkForMattermost(markdown, mattermostTraits.maxMessageLength!)
  const chunkCount = chunks.length
  // Chunks must be sent sequentially to preserve message ordering.
  // Use p-limit with concurrency=1 to enforce sequential execution without await-in-loop.
  const sendOne = pLimit(1)
  let firstId: string | undefined
  let firstError: Error | undefined

  await Promise.all(
    chunks.map((chunk, chunkIndex) =>
      sendOne(async () => {
        try {
          const id = await post(chunk, options)
          if (chunkIndex === 0) firstId = id
        } catch (error) {
          const sendError = error instanceof Error ? error : new Error(String(error))
          firstError ??= sendError
          log.warn(
            { channelId, chunkIndex, chunkCount, error: sendError.message },
            'Failed to send Mattermost reply chunk',
          )
        }
      }),
    ),
  )

  if (firstError !== undefined) throw firstError
  return firstId
}
