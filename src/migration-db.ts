import { getDb } from './db/index.js'
import { clearHistory } from './history.js'
import { logger } from './logger.js'
import { clearFacts, clearSummary } from './memory.js'
import type { ConfigRow, UserRow } from './migration-types.js'

const log = logger.child({ scope: 'migration:db' })

export function getUsers(singleUserId: number | undefined): UserRow[] {
  if (singleUserId !== undefined) {
    return getDb()
      .query<UserRow, [number]>('SELECT telegram_id, username FROM users WHERE telegram_id = ?')
      .all(singleUserId)
  }
  return getDb().query<UserRow, []>('SELECT telegram_id, username FROM users').all()
}

export function getUserConfig(userId: number): Map<string, string> {
  const rows = getDb().query<ConfigRow, [number]>('SELECT key, value FROM user_config WHERE user_id = ?').all(userId)
  return new Map(rows.map((r) => [r.key, r.value]))
}

export function clearUserHistoryInDb(userId: number): void {
  clearHistory(userId)
  clearSummary(userId)
  clearFacts(userId)
  log.info({ userId }, 'Conversation history and memory cleared')
}

export function deleteLinearConfig(userId: number): void {
  getDb().run("DELETE FROM user_config WHERE user_id = ? AND key IN ('linear_key', 'linear_team_id')", [userId])
  log.info({ userId }, 'Linear config removed after migration')
}
