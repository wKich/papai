import { supportsFileReplies } from '../chat/capabilities.js'
import type { ChatCapability, ChatProvider, CommandHandler, ContextType } from '../chat/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:help' })

const DM_USER_HELP = [
  'papai — AI assistant for Kaneo task management',
  '',
  'Commands:',
  '/help — Show this message',
  '/setup — Interactive configuration wizard for personal or group settings',
  '/config — View or edit personal settings, or choose a group to configure from DM',
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
  '/announce <message> — Send announcement to all users',
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
      '/clear — Clear group conversation history',
      '',
      'Group settings are configured in DM with the bot.',
    ].join('\n')
  }

  return text
}

export function buildHelpText(
  capabilities: ReadonlySet<ChatCapability>,
  contextType: ContextType,
  opts: { isBotAdmin: boolean; isGroupAdmin: boolean },
): string {
  let helpText = contextType === 'dm' ? getDmHelpText(opts.isBotAdmin) : getGroupHelpText(opts.isGroupAdmin)

  if (!supportsFileReplies({ capabilities }) && opts.isBotAdmin) {
    helpText += '\n\nNote: `/context` export is deferred on this platform.'
  }

  return helpText
}

export function registerHelpCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    log.info({ userId: msg.user.id, contextType: msg.contextType }, '/help command executed')

    const helpText = buildHelpText(chat.capabilities, msg.contextType, {
      isBotAdmin: auth.isBotAdmin,
      isGroupAdmin: auth.isGroupAdmin,
    })
    await reply.text(helpText)
  }

  chat.registerCommand('help', handler)
}
