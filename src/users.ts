import { eq, or } from 'drizzle-orm'

import { getCachedWorkspace, setCachedWorkspace } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { users } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'users' })

interface UserRecord {
  platform_user_id: string
  username: string | null
  added_at: string
  added_by: string
}

export function addUser(userId: string, addedBy: string, username?: string): void {
  log.debug({ hasUsername: username !== undefined }, 'addUser called')
  const db = getDrizzleDb()

  db.insert(users)
    .values({
      platformUserId: userId,
      username: username ?? null,
      addedBy,
    })
    .onConflictDoUpdate({
      target: users.platformUserId,
      set: { username: username ?? null },
    })
    .run()

  log.info({ hasUsername: username !== undefined }, 'User added')
}

export function removeUser(identifier: string): void {
  log.debug('removeUser called')
  const db = getDrizzleDb()

  db.delete(users)
    .where(or(eq(users.username, identifier), eq(users.platformUserId, identifier)))
    .run()

  log.info('User removed')
}

export function isAuthorized(userId: string): boolean {
  log.debug('isAuthorized called')
  const db = getDrizzleDb()

  const row = db
    .select({ platformUserId: users.platformUserId })
    .from(users)
    .where(eq(users.platformUserId, userId))
    .get()

  return row !== undefined
}

export function resolveUserByUsername(userId: string, username: string): boolean {
  log.debug('resolveUserByUsername called')
  const db = getDrizzleDb()

  const row = db.select({ platformUserId: users.platformUserId }).from(users).where(eq(users.username, username)).get()

  if (row === undefined) return false
  if (row.platformUserId === userId) return true

  db.update(users).set({ platformUserId: userId }).where(eq(users.username, username)).run()

  log.info('User platform_user_id resolved from username')
  return true
}

export function listUsers(): UserRecord[] {
  log.debug('listUsers called')
  const db = getDrizzleDb()

  return db
    .select({
      platform_user_id: users.platformUserId,
      username: users.username,
      added_at: users.addedAt,
      added_by: users.addedBy,
    })
    .from(users)
    .all()
}

export function getKaneoWorkspace(userId: string): string | null {
  log.debug('getKaneoWorkspace called')
  return getCachedWorkspace(userId)
}

export function setKaneoWorkspace(userId: string, workspaceId: string): void {
  log.debug('setKaneoWorkspace called')
  setCachedWorkspace(userId, workspaceId)
  log.info('Kaneo workspace ID stored (DB sync in background)')
}
