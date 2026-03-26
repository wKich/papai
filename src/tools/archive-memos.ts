import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { archiveMemos } from '../memos.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:memo' })

function buildDescription(tag?: string, beforeDate?: string, memoIds?: string[]): string {
  if (tag !== undefined) return `Archive all notes tagged "${tag}"`
  if (beforeDate !== undefined) return `Archive all notes before ${beforeDate}`
  return `Archive ${memoIds?.length ?? 0} note(s)`
}

export function makeArchiveMemosTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Archive personal notes by tag, date, or specific IDs. At least one filter must be provided.',
    inputSchema: z.object({
      tag: z.string().optional().describe('Archive all memos with this tag'),
      before_date: z.string().optional().describe('Archive memos created before this ISO date'),
      memo_ids: z.array(z.string()).optional().describe('Archive specific memos by ID'),
      confidence: confidenceField,
    }),
    execute: ({ tag, before_date, memo_ids, confidence }) => {
      log.debug({ userId, tag, before_date, memoIdCount: memo_ids?.length, confidence }, 'archive_memos called')

      const hasFilter =
        tag !== undefined || before_date !== undefined || (memo_ids !== undefined && memo_ids.length > 0)
      if (!hasFilter) {
        log.warn({ userId }, 'archive_memos rejected — no filter provided')
        return { status: 'error', message: 'At least one filter (tag, before_date, or memo_ids) is required.' }
      }

      const gate = checkConfidence(confidence, buildDescription(tag, before_date, memo_ids))
      if (gate !== null) {
        log.warn({ userId, confidence }, 'archive_memos blocked — confirmation required')
        return gate
      }

      const count = archiveMemos(userId, { tag, beforeDate: before_date, memoIds: memo_ids })
      log.info({ userId, count, tag, before_date }, 'Memos archived via tool')
      return { status: 'archived', count }
    },
  })
}
