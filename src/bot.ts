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
import { isAuthorized, resolveUserByUsername } from './users.js'

const log = logger.child({ scope: 'bot' })

const checkAuthorization = (userId: string, username?: string | null): boolean => {
  log.debug({ userId }, 'Checking authorization')
  if (isAuthorized(userId)) return true
  if (username !== undefined && username !== null && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}

export const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  isPlatformAdmin: boolean,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType }, 'Checking authorization')

  // Bot admin can do everything
  if (isAuthorized(userId)) {
    return {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: isPlatformAdmin,
      storageContextId: contextType === 'dm' ? userId : contextId,
    }
  }

  // In groups, check group membership
  if (contextType === 'group') {
    if (isGroupMember(contextId, userId)) {
      return {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: isPlatformAdmin,
        storageContextId: contextId,
      }
    }
    return {
      allowed: false,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: contextId,
    }
  }

  // In DMs, try to resolve by username
  if (username !== null && resolveUserByUsername(userId, username)) {
    return {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: userId,
    }
  }

  return {
    allowed: false,
    isBotAdmin: false,
    isGroupAdmin: false,
    storageContextId: userId,
  }
}

export function setupBot(chat: ChatProvider, adminUserId: string): void {
  registerHelpCommand(chat, checkAuthorization, adminUserId)
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

    // Natural language in groups requires mention
    if (msg.contextType === 'group' && !msg.commandMatch && !msg.isMentioned) {
      return // Silent ignore
    }

    reply.typing()
    await processMessage(reply, auth.storageContextId, msg.user.username, msg.text)
  })
}
