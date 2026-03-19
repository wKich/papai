import { getCachedWorkspace, setCachedWorkspace } from './cache.js'
import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'users' })

interface UserRecord {
  platform_user_id: string
  username: string | null
  added_at: string
  added_by: string
}

export function addUser(userId: string, addedBy: string, username?: string): void {
  log.debug({ userId, addedBy, hasUsername: username !== undefined }, 'addUser called')
  if (username === undefined) {
    getDb().run('INSERT INTO users (platform_user_id, added_by) VALUES (?, ?) ON CONFLICT DO NOTHING', [
      userId,
      addedBy,
    ])
  } else {
    getDb().run(
      'INSERT INTO users (platform_user_id, username, added_by) VALUES (?, ?, ?) ON CONFLICT(platform_user_id) DO UPDATE SET username = excluded.username',
      [userId, username, addedBy],
    )
  }
  log.info({ userId, addedBy, hasUsername: username !== undefined }, 'User added')
}

export function removeUser(identifier: string): void {
  log.debug({ identifier }, 'removeUser called')
  getDb().run('DELETE FROM users WHERE username = ? OR platform_user_id = ?', [identifier, identifier])
  log.info({ identifier }, 'User removed')
}

export function isAuthorized(userId: string): boolean {
  log.debug({ userId }, 'isAuthorized called')
  const row = getDb()
    .query<{ platform_user_id: string }, [string]>('SELECT platform_user_id FROM users WHERE platform_user_id = ?')
    .get(userId)
  return row !== null
}

export function resolveUserByUsername(userId: string, username: string): boolean {
  log.debug({ userId, username }, 'resolveUserByUsername called')
  const row = getDb()
    .query<{ platform_user_id: string }, [string]>('SELECT platform_user_id FROM users WHERE username = ?')
    .get(username)
  if (row === null) return false
  if (row.platform_user_id === userId) return true

  getDb().run('UPDATE users SET platform_user_id = ? WHERE username = ?', [userId, username])
  log.info({ userId, username }, 'User platform_user_id resolved from username')
  return true
}

export function listUsers(): UserRecord[] {
  log.debug('listUsers called')
  return getDb().query<UserRecord, []>('SELECT platform_user_id, username, added_at, added_by FROM users').all()
}

export function getKaneoWorkspace(userId: string): string | null {
  log.debug({ userId }, 'getKaneoWorkspace called')
  return getCachedWorkspace(userId)
}

export function setKaneoWorkspace(userId: string, workspaceId: string): void {
  log.debug({ userId }, 'setKaneoWorkspace called')
  setCachedWorkspace(userId, workspaceId)
  log.info({ userId }, 'Kaneo workspace ID stored (DB sync in background)')
}
