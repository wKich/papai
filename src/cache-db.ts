import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'cache-db' })

export function syncHistoryToDb(userId: number, messages: unknown[]): void {
  queueMicrotask(() => {
    try {
      getDb().run('INSERT OR REPLACE INTO conversation_history (user_id, messages) VALUES (?, ?)', [
        userId,
        JSON.stringify(messages),
      ])
      log.debug({ userId, messageCount: messages.length }, 'History synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync history to DB',
      )
    }
  })
}

export function syncSummaryToDb(userId: number, summary: string): void {
  queueMicrotask(() => {
    try {
      getDb().run('INSERT OR REPLACE INTO memory_summary (user_id, summary, updated_at) VALUES (?, ?, ?)', [
        userId,
        summary,
        new Date().toISOString(),
      ])
      log.debug({ userId, summaryLength: summary.length }, 'Summary synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync summary to DB',
      )
    }
  })
}

export function syncFactToDb(
  userId: number,
  fact: { identifier: string; title: string; url: string },
  now: string,
): void {
  queueMicrotask(() => {
    try {
      const db = getDb()
      db.run('BEGIN TRANSACTION')
      try {
        db.run(
          'INSERT OR REPLACE INTO memory_facts (user_id, identifier, title, url, last_seen) VALUES (?, ?, ?, ?, ?)',
          [userId, fact.identifier, fact.title, fact.url, now],
        )
        db.run(
          `DELETE FROM memory_facts WHERE user_id = ? AND identifier NOT IN (
            SELECT identifier FROM memory_facts WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?
          )`,
          [userId, userId, 50],
        )
        db.run('COMMIT')
        log.debug({ userId, identifier: fact.identifier }, 'Fact synced to DB')
      } catch (error) {
        db.run('ROLLBACK')
        throw error
      }
    } catch (error) {
      log.error({ userId, error: error instanceof Error ? error.message : String(error) }, 'Failed to sync fact to DB')
    }
  })
}

export function syncConfigToDb(userId: number, key: string, value: string): void {
  queueMicrotask(() => {
    try {
      getDb().run('INSERT OR REPLACE INTO user_config (user_id, key, value) VALUES (?, ?, ?)', [userId, key, value])
      log.debug({ userId, key }, 'Config synced to DB')
    } catch (error) {
      log.error(
        { userId, key, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync config to DB',
      )
    }
  })
}

export function syncWorkspaceToDb(userId: number, workspaceId: string): void {
  queueMicrotask(() => {
    try {
      getDb().run('UPDATE users SET kaneo_workspace_id = ? WHERE telegram_id = ?', [workspaceId, userId])
      log.debug({ userId }, 'Workspace synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync workspace to DB',
      )
    }
  })
}
