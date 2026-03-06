import { type ModelMessage } from 'ai'

import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'history' })

// Minimal validation — we trust our own serialisation but guard against corrupt rows.
const isMessageArray = (value: unknown): value is ModelMessage[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'role' in item)

export function loadHistory(userId: number): readonly ModelMessage[] {
  log.debug({ userId }, 'loadHistory called')
  const row = getDb()
    .query<{ messages: string }, [number]>('SELECT messages FROM conversation_history WHERE user_id = ?')
    .get(userId)

  if (row === null) {
    log.debug({ userId }, 'No persisted history found')
    return []
  }

  if (typeof row.messages !== 'string') {
    log.warn({ userId }, 'Corrupt history row — resetting')
    return []
  }

  try {
    const raw: unknown = JSON.parse(row.messages)
    if (!isMessageArray(raw)) {
      log.warn({ userId }, 'Invalid history format — resetting')
      return []
    }
    log.info({ userId, messageCount: raw.length }, 'History loaded')
    return raw
  } catch (error) {
    log.warn(
      { userId, error: error instanceof Error ? error.message : String(error) },
      'Failed to parse history JSON — resetting',
    )
    return []
  }
}

export function saveHistory(userId: number, messages: readonly ModelMessage[]): void {
  log.debug({ userId, messageCount: messages.length }, 'saveHistory called')
  getDb().run('INSERT OR REPLACE INTO conversation_history (user_id, messages) VALUES (?, ?)', [
    userId,
    JSON.stringify(messages),
  ])
  log.info({ userId, messageCount: messages.length }, 'History saved')
}

export function clearHistory(userId: number): void {
  log.debug({ userId }, 'clearHistory called')
  getDb().run('DELETE FROM conversation_history WHERE user_id = ?', [userId])
  log.info({ userId }, 'History cleared')
}
