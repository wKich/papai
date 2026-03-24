import { lt } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { backgroundEvents } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'deferred:background-events' })

const RESPONSE_CAP = 2000

/**
 * Record a background event for audit purposes.
 * Proactive responses are now saved directly to conversation history by the poller,
 * so this serves as an audit trail only.
 */
export const recordBackgroundEvent = (
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  response: string,
): void => {
  log.debug({ userId, type }, 'recordBackgroundEvent called')
  const db = getDrizzleDb()
  db.insert(backgroundEvents)
    .values({
      id: crypto.randomUUID(),
      userId,
      type,
      prompt,
      response: response.slice(0, RESPONSE_CAP),
      createdAt: new Date().toISOString(),
      injectedAt: null,
    })
    .run()
  log.info({ userId, type }, 'Background event recorded')
}

export const pruneBackgroundEvents = (olderThanDays = 30): void => {
  log.debug({ olderThanDays }, 'pruneBackgroundEvents called')
  const db = getDrizzleDb()
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  db.delete(backgroundEvents).where(lt(backgroundEvents.createdAt, cutoff)).run()
  log.info({ olderThanDays }, 'Old background events pruned')
}
