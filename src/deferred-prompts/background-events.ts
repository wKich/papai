import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { backgroundEvents, type BackgroundEventRow } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'deferred:background-events' })

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
      response,
      createdAt: new Date().toISOString(),
      injectedAt: null,
    })
    .run()
  log.info({ userId, type }, 'Background event recorded')
}

export const loadUnseenEvents = (userId: string): BackgroundEventRow[] => {
  log.debug({ userId }, 'loadUnseenEvents called')
  const db = getDrizzleDb()
  return db
    .select()
    .from(backgroundEvents)
    .where(and(eq(backgroundEvents.userId, userId), isNull(backgroundEvents.injectedAt)))
    .orderBy(backgroundEvents.createdAt)
    .all()
}

export const markEventsInjected = (ids: string[]): void => {
  if (ids.length === 0) return
  log.debug({ count: ids.length }, 'markEventsInjected called')
  const db = getDrizzleDb()
  db.update(backgroundEvents)
    .set({ injectedAt: new Date().toISOString() })
    .where(inArray(backgroundEvents.id, ids))
    .run()
  log.info({ count: ids.length }, 'Background events marked injected')
}

export const pruneBackgroundEvents = (olderThanDays = 30): void => {
  log.debug({ olderThanDays }, 'pruneBackgroundEvents called')
  const db = getDrizzleDb()
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  db.delete(backgroundEvents)
    .where(and(lt(backgroundEvents.createdAt, cutoff), isNotNull(backgroundEvents.injectedAt)))
    .run()
  log.info({ olderThanDays }, 'Old background events pruned')
}

export const formatBackgroundEventsMessage = (
  events: Array<{ type: string; prompt: string; response: string; createdAt: string }>,
): string => {
  const lines = events.map((e) => {
    const ts = new Date(e.createdAt).toUTCString().replace(' GMT', ' UTC')
    return `[${ts} | ${e.type}] ${e.prompt}\n→ ${e.response}`
  })
  return `[Background tasks completed while you were away]\n\n${lines.join('\n\n')}`
}

export const consumeUnseenEvents = (
  userId: string,
): {
  eventIds: string[]
  systemContent: string
  historyEntries: Array<{ role: 'system'; content: string }>
} | null => {
  const events = loadUnseenEvents(userId)
  if (events.length === 0) return null
  log.debug({ userId, count: events.length }, 'Consuming unseen background events')
  const systemContent = formatBackgroundEventsMessage(events)
  const historyEntries = events.map((e) => ({
    role: 'system' as const,
    content: `[Background: ${e.type} | ${e.createdAt}]\n${e.prompt}\n→ ${e.response}`,
  }))
  const eventIds = events.map((e) => e.id)
  log.info({ userId, count: events.length }, 'Unseen background events loaded for injection')
  return { eventIds, systemContent, historyEntries }
}
