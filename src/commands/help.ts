import type { Bot } from 'grammy'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:help' })

const USER_COMMANDS = [
  { command: 'help', description: 'Show available commands' },
  { command: 'set', description: 'Set a config value — /set <key> <value>' },
  { command: 'config', description: 'View current configuration' },
  { command: 'clear', description: 'Clear conversation history and memory' },
] as const

const ADMIN_COMMANDS = [
  { command: 'context', description: 'Show current memory context (summary and known entities)' },
  { command: 'user', description: 'Manage users — /user add|remove <id|@username>' },
  { command: 'users', description: 'List authorized users' },
] as const

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
  bot: Bot,
  checkAuthorization: (userId: number | undefined, username?: string) => userId is number,
  adminUserId: number,
): void {
  bot.command('help', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAuthorization(userId, ctx.from?.username)) return
    log.info({ userId }, '/help command executed')
    const text = userId === adminUserId ? USER_HELP + ADMIN_HELP : USER_HELP
    await ctx.reply(text)
  })
}

export async function setCommands(bot: Bot, adminUserId: number): Promise<void> {
  await bot.api.setMyCommands(USER_COMMANDS, {
    scope: { type: 'all_private_chats' },
  })
  await bot.api.setMyCommands([...USER_COMMANDS, ...ADMIN_COMMANDS], {
    scope: { type: 'chat', chat_id: adminUserId },
  })
  log.info({ adminUserId }, 'Bot commands registered with Telegram')
}
