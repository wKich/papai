import type { AuthorizationResult, ChatProvider, ContextType } from './chat/types.js'
import {
  registerAdminCommands,
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerGroupCommand,
  registerHelpCommand,
  registerSetCommand,
} from './commands/index.js'
import { isGroupMember } from './groups.js'
import { processMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { isAuthorized, resolveUserByUsername } from './users.js'

const log = logger.child({ scope: 'bot' })

const checkAuthorization = (userId: string, username?: string | null): boolean => {
  log.debug({ userId }, 'Checking authorization')
  if (isAuthorized(userId)) return true
  if (username !== undefined && username !== null && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}

const getBotAdminAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  isPlatformAdmin: boolean,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: contextType === 'dm' ? userId : contextId,
})

const getGroupMemberAuth = (contextId: string, isPlatformAdmin: boolean): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: contextId,
})

const getUnauthorizedGroupAuth = (contextId: string): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: contextId,
})

const getDmUserAuth = (userId: string): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: false,
  storageContextId: userId,
})

const getUnauthorizedDmAuth = (userId: string): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: userId,
})

export const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  isPlatformAdmin: boolean,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType }, 'Checking authorization')

  if (isAuthorized(userId)) {
    return getBotAdminAuth(userId, contextId, contextType, isPlatformAdmin)
  }

  if (contextType === 'group') {
    if (isGroupMember(contextId, userId)) {
      return getGroupMemberAuth(contextId, isPlatformAdmin)
    }
    return getUnauthorizedGroupAuth(contextId)
  }

  if (username !== null && resolveUserByUsername(userId, username)) {
    return getDmUserAuth(userId)
  }

  return getUnauthorizedDmAuth(userId)
}

export function setupBot(chat: ChatProvider, adminUserId: string): void {
  registerHelpCommand(chat)
  registerSetCommand(chat, checkAuthorization)
  registerConfigCommand(chat, checkAuthorization)
  registerContextCommand(chat, adminUserId)
  registerClearCommand(chat, checkAuthorization, adminUserId)
  registerAdminCommands(chat, adminUserId)
  registerGroupCommand(chat)
  chat.onMessage(async (msg, reply) => {
    const auth = checkAuthorizationExtended(
      msg.user.id,
      msg.user.username,
      msg.contextId,
      msg.contextType,
      msg.user.isAdmin,
    )

    if (!auth.allowed) {
      if (msg.isMentioned) {
        await reply.text(
          "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
        )
      }
      return
    }

    const hasCommand = msg.commandMatch !== undefined && msg.commandMatch !== ''
    const isNaturalLanguage = !hasCommand
    if (msg.contextType === 'group' && isNaturalLanguage && !msg.isMentioned) {
      // Silent ignore - natural language in groups requires mention
      return
    }

    reply.typing()
    const prompt = buildPromptWithReplyContext(msg)
    await processMessage(reply, auth.storageContextId, msg.user.username, prompt)
  })
}
