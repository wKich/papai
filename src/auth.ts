import type { AuthorizationResult, ContextType } from './chat/types.js'
import { isGroupMember } from './groups.js'
import { logger } from './logger.js'
import { addUser, isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'

const log = logger.child({ scope: 'auth' })

/**
 * Generates storage context ID with thread scoping.
 * - DMs: userId
 * - Main chat: groupId
 * - Thread: groupId:threadId
 */
export function getThreadScopedStorageContextId(
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
): string {
  if (contextType === 'dm') return contextId
  // Main chat: use groupId
  if (threadId === undefined) return contextId
  // Thread: use groupId:threadId for history isolation
  return `${contextId}:${threadId}`
}

const getBotAdminAuth = (
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId),
  configContextId: contextId,
})

const getGroupMemberAuth = (
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId),
  configContextId: contextId,
})

const getUnauthorizedGroupAuth = (contextId: string): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: contextId,
  configContextId: contextId,
})

const getDmUserAuth = (userId: string): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: false,
  storageContextId: userId,
  configContextId: userId,
})

const getUnauthorizedDmAuth = (userId: string): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: userId,
  configContextId: userId,
})

export const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType, threadId }, 'Checking authorization')

  if (process.env['DEMO_MODE'] === 'true' && !isAuthorized(userId) && contextType === 'dm') {
    log.info({ userId, username }, 'Demo mode: auto-adding user')
    addUser(userId, 'demo-auto', username ?? undefined)
    return getGroupMemberAuth(contextId, contextType, threadId, false)
  }

  if (isAuthorized(userId)) {
    if (contextType === 'dm' && isDemoUser(userId)) {
      return getGroupMemberAuth(contextId, contextType, threadId, false)
    }
    return getBotAdminAuth(contextId, contextType, threadId, isPlatformAdmin)
  }

  if (contextType === 'group') {
    if (isGroupMember(contextId, userId)) {
      return getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin)
    }
    return getUnauthorizedGroupAuth(contextId)
  }

  if (username !== null && resolveUserByUsername(userId, username)) {
    return getDmUserAuth(userId)
  }

  return getUnauthorizedDmAuth(userId)
}
