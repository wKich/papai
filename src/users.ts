import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'users' })

export interface UserRecord {
  telegram_id: number
  username: string | null
  added_at: string
  added_by: number
}

export function addUser(telegramId: number, addedBy: number, username?: string): void {
  log.debug({ telegramId, addedBy, hasUsername: username !== undefined }, 'addUser called')
  if (username === undefined) {
    getDb().run('INSERT INTO users (telegram_id, added_by) VALUES (?, ?) ON CONFLICT DO NOTHING', [telegramId, addedBy])
  } else {
    getDb().run(
      'INSERT INTO users (telegram_id, username, added_by) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username',
      [telegramId, username, addedBy],
    )
  }
  log.info({ telegramId, addedBy, hasUsername: username !== undefined }, 'User added')
}

export function removeUser(identifier: number | string): void {
  log.debug({ identifier }, 'removeUser called')
  if (typeof identifier === 'string') {
    getDb().run('DELETE FROM users WHERE username = ?', [identifier])
  } else {
    getDb().run('DELETE FROM users WHERE telegram_id = ?', [identifier])
  }
  log.info({ identifier }, 'User removed')
}

export function isAuthorized(telegramId: number): boolean {
  log.debug({ telegramId }, 'isAuthorized called')
  const row = getDb()
    .query<{ telegram_id: number }, [number]>('SELECT telegram_id FROM users WHERE telegram_id = ?')
    .get(telegramId)
  return row !== null
}

export function isAuthorizedByUsername(username: string): boolean {
  log.debug({ username }, 'isAuthorizedByUsername called')
  const row = getDb()
    .query<{ telegram_id: number }, [string]>('SELECT telegram_id FROM users WHERE username = ?')
    .get(username)
  return row !== null
}

export function resolveUserByUsername(telegramId: number, username: string): boolean {
  log.debug({ telegramId, username }, 'resolveUserByUsername called')
  const row = getDb()
    .query<{ telegram_id: number }, [string]>('SELECT telegram_id FROM users WHERE username = ?')
    .get(username)
  if (row === null) return false
  if (row.telegram_id === telegramId) return true

  getDb().run('UPDATE users SET telegram_id = ? WHERE username = ?', [telegramId, username])
  log.info({ telegramId, username }, 'User telegram_id resolved from username')
  return true
}

export function listUsers(): UserRecord[] {
  log.debug('listUsers called')
  return getDb().query<UserRecord, []>('SELECT telegram_id, username, added_at, added_by FROM users').all()
}
