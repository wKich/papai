import type { ChatProvider } from '../chat/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:help' })

const USER_HELP = [
  'papai — AI assistant for Kaneo task management',
  '',
  'Commands:',
  '/help — Show this message',
  '/set <key> <value> — Set a config value',
  '/config — View current configuration',
  '/clear — Clear conversation history and memory',
  '',
  'Any other message is sent to the AI assistant.',
].join('\n')

const ADMIN_HELP = [
  '',
  'Admin commands:',
  '/context — Show current memory context (summary and known entities)',
  '/user add <id|@username> — Authorize a user',
  '/user remove <id|@username> — Revoke access',
  '/users — List authorized users',
  "/clear <user_id> — Clear a specific user's history",
  "/clear all — Clear all users' history",
].join('\n')

export function registerHelpCommand(
  chat: ChatProvider,
  checkAuthorization: (userId: string, username?: string | null) => boolean,
  adminUserId: string,
): void {
  chat.registerCommand('help', async (msg, reply) => {
    if (!checkAuthorization(msg.user.id, msg.user.username)) return
    log.info({ userId: msg.user.id }, '/help command executed')
    const text = msg.user.id === adminUserId ? USER_HELP + ADMIN_HELP : USER_HELP
    await reply.text(text)
  })
}
