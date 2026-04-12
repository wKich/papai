import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { webRateLimit } from '../db/schema.js'
import { logger } from '../logger.js'
import type { RateLimitResult } from './types.js'

const log = logger.child({ scope: 'web:rate-limit' })

const WINDOW_MS = 5 * 60 * 1000
const LIMIT = 20

export function consumeWebFetchQuota(actorId: string, nowMs: number = Date.now()): RateLimitResult {
  const db = getDrizzleDb()
  const windowStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS
  const existing = db
    .select()
    .from(webRateLimit)
    .where(and(eq(webRateLimit.actorId, actorId), eq(webRateLimit.windowStart, windowStart)))
    .get()

  if (existing === undefined) {
    db.insert(webRateLimit).values({ actorId, windowStart, count: 1 }).run()

    log.info({ actorId, windowStart, count: 1, remaining: LIMIT - 1 }, 'Consumed web fetch quota')
    return { allowed: true, remaining: LIMIT - 1 }
  }

  if (existing.count >= LIMIT) {
    const retryAfterSec = Math.ceil((windowStart + WINDOW_MS - nowMs) / 1000)

    log.warn({ actorId, windowStart, count: existing.count, retryAfterSec }, 'Web fetch quota exceeded')
    return { allowed: false, remaining: 0, retryAfterSec }
  }

  const nextCount = existing.count + 1
  const remaining = LIMIT - nextCount

  db.update(webRateLimit)
    .set({ count: nextCount })
    .where(and(eq(webRateLimit.actorId, actorId), eq(webRateLimit.windowStart, windowStart)))
    .run()

  log.info({ actorId, windowStart, count: nextCount, remaining }, 'Consumed web fetch quota')
  return { allowed: true, remaining }
}
