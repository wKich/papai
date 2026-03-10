import chunter from '@hcengineering/chunter'
import type { Space } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { ensureRef } from '../huly/refs.js'
import type { HulyClient } from '../huly/types.js'
import { logger } from '../logger.js'
import type { LinearComment } from './linear-client.js'

const log = logger.child({ scope: 'migration:comments' })

export async function migrateComments(
  client: HulyClient,
  projectId: string,
  issueId: string,
  comments: LinearComment[],
): Promise<void> {
  if (comments.length === 0) return

  ensureRef<Space>(projectId)
  ensureRef<Issue>(issueId)

  const results = await Promise.allSettled(
    comments.map((comment) =>
      client.addCollection(chunter.class.ChatMessage, projectId, issueId, tracker.class.Issue, 'comments', {
        message: `**${comment.authorName}** (imported from Linear)\n\n${comment.body}`,
        attachments: 0,
      }),
    ),
  )

  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      log.warn({ issueId, commentIndex: i, error: message }, 'Failed to migrate comment, skipping')
    } else {
      log.info({ issueId, authorName: comments[i]?.authorName }, 'Migrated comment')
    }
  }
}
