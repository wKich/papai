import { and, eq, gt, lte, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { logger } from '../logger.js'
import type { CachedMessage } from './types.js'

const log = logger.child({ scope: 'message-cache:persistence' })

// Queue for pending writes
const pendingWrites = new Map<string, CachedMessage>()
let isFlushScheduled = false

// 1 week in milliseconds
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function scheduleMessagePersistence(message: CachedMessage): void {
  pendingWrites.set(`${message.contextId}:${message.messageId}`, message)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (isFlushScheduled) return
  isFlushScheduled = true
  queueMicrotask(() => {
    isFlushScheduled = false
    try {
      flushPendingWrites()
    } catch (err) {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Failed to flush message cache to database',
      )
    }
  })
}

function flushPendingWrites(): void {
  if (pendingWrites.size === 0) return

  const writes = Array.from(pendingWrites.values())
  pendingWrites.clear()

  const db = getDrizzleDb()

  try {
    db.insert(messageMetadata)
      .values(
        writes.map((msg) => ({
          messageId: msg.messageId,
          contextId: msg.contextId,
          authorId: msg.authorId ?? null,
          authorUsername: msg.authorUsername ?? null,
          text: msg.text ?? null,
          replyToMessageId: msg.replyToMessageId ?? null,
          timestamp: msg.timestamp,
          expiresAt: msg.timestamp + ONE_WEEK_MS,
        })),
      )
      .onConflictDoUpdate({
        target: [messageMetadata.contextId, messageMetadata.messageId],
        set: {
          authorId: sql`excluded.author_id`,
          authorUsername: sql`excluded.author_username`,
          text: sql`excluded.text`,
          replyToMessageId: sql`excluded.reply_to_message_id`,
          timestamp: sql`excluded.timestamp`,
          expiresAt: sql`excluded.expires_at`,
        },
      })
      .run()

    log.debug({ count: writes.length }, 'Persisted messages to database')
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err), count: writes.length },
      'Failed to persist messages',
    )
    // Re-queue failed writes and schedule retry
    for (const msg of writes) {
      pendingWrites.set(`${msg.contextId}:${msg.messageId}`, msg)
    }
    setTimeout(scheduleFlush, 5000)
  }
}

/** @public */
export function loadMessagesFromDb(contextId: string): CachedMessage[] {
  const db = getDrizzleDb()
  const now = Date.now()

  const rows = db
    .select()
    .from(messageMetadata)
    .where(and(eq(messageMetadata.contextId, contextId), gt(messageMetadata.expiresAt, now)))
    .all()

  return rows.map((row) => ({
    messageId: row.messageId,
    contextId: row.contextId,
    authorId: row.authorId ?? undefined,
    authorUsername: row.authorUsername ?? undefined,
    text: row.text ?? undefined,
    replyToMessageId: row.replyToMessageId ?? undefined,
    timestamp: row.timestamp,
  }))
}

export function cleanupExpiredMessages(): void {
  const db = getDrizzleDb()
  const now = Date.now()

  try {
    db.delete(messageMetadata).where(lte(messageMetadata.expiresAt, now)).run()
    log.debug('Cleaned up expired message metadata')
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to cleanup expired messages')
  }
}

/** Start hourly cleanup of expired message metadata from the database. */
export function startMessageCleanupScheduler(): void {
  setInterval(
    () => {
      cleanupExpiredMessages()
    },
    60 * 60 * 1000,
  )
  log.debug('Message cleanup scheduler started (hourly)')
}
