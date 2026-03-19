import type { ChatProvider } from './chat/types.js'
import {
  registerAdminCommands,
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerHelpCommand,
  registerSetCommand,
} from './commands/index.js'
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

export function setupBot(chat: ChatProvider, adminUserId: string): void {
  registerHelpCommand(chat, checkAuthorization, adminUserId)
  registerSetCommand(chat, checkAuthorization)
  registerConfigCommand(chat, checkAuthorization)
  registerContextCommand(chat, adminUserId)
  registerClearCommand(chat, checkAuthorization, adminUserId)
  registerAdminCommands(chat, adminUserId)
  chat.onMessage(async (msg, reply) => {
    if (!checkAuthorization(msg.user.id, msg.user.username)) return
    reply.typing()
    await processMessage(reply, msg.user.id, msg.user.username, msg.text)
  })
}
