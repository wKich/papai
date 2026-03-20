import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:help' })

const DM_USER_HELP = [
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

const DM_ADMIN_HELP = [
  '',
  'Admin commands:',
  '/context — Show current memory context (summary and known entities)',
  '/user add <id|@username> — Authorize a user',
  '/user remove <id|@username> — Revoke access',
  '/users — List authorized users',
  "/clear <user_id> — Clear a specific user's history",
  "/clear all — Clear all users' history",
].join('\n')

function getDmHelpText(isAdmin: boolean): string {
  return isAdmin ? DM_USER_HELP + DM_ADMIN_HELP : DM_USER_HELP
}

function getGroupHelpText(isGroupAdmin: boolean): string {
  let text = [
    'papai — AI assistant for Kaneo task management',
    '',
    'Group commands:',
    '/help — Show this message',
    '/group adduser <@username> — Add member to group',
    '/group deluser <@username> — Remove member from group',
    '/group users — List group members',
    '',
    'Mention me with @botname for natural language queries',
  ].join('\n')

  if (isGroupAdmin) {
    text += [
      '',
      'Admin commands:',
      '/set <key> <value> — Set group configuration',
      '/config — View group configuration',
      '/clear — Clear group conversation history',
    ].join('\n')
  }

  return text
}

export function registerHelpCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    log.info({ userId: msg.user.id, contextType: msg.contextType }, '/help command executed')

    if (msg.contextType === 'dm') {
      await reply.text(getDmHelpText(auth.isBotAdmin))
    } else {
      await reply.text(getGroupHelpText(auth.isGroupAdmin))
    }
  }

  chat.registerCommand('help', handler)
}
