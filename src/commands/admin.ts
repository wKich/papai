import type { Bot, Context } from 'grammy'

import { logger } from '../logger.js'
import { provisionAndConfigure } from '../providers/kaneo/provision.js'
import { addUser, listUsers, removeUser } from '../users.js'

const log = logger.child({ scope: 'admin' })

const parseUserIdentifier = (
  input: string,
): { type: 'id'; value: number } | { type: 'username'; value: string } | null => {
  const trimmed = input.trim()
  if (trimmed.startsWith('@')) return { type: 'username', value: trimmed.slice(1) }
  const num = parseInt(trimmed, 10)
  if (!Number.isNaN(num) && String(num) === trimmed) return { type: 'id', value: num }
  if (/^[a-zA-Z0-9_]+$/.test(trimmed)) return { type: 'username', value: trimmed }
  return null
}

export function registerAdminCommands(bot: Bot, adminUserId: number): void {
  const checkAdmin = (userId: number | undefined): userId is number => {
    return userId !== undefined && userId === adminUserId
  }

  bot.command('user', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAdmin(userId)) {
      await ctx.reply('Only the admin can manage users.')
      return
    }
    await handleUserCommand(ctx, userId, adminUserId)
  })

  bot.command('users', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAdmin(userId)) {
      await ctx.reply('Only the admin can list users.')
      return
    }
    await handleUsersCommand(ctx, userId, adminUserId)
  })
}

async function handleUserCommand(ctx: Context, userId: number, adminUserId: number): Promise<void> {
  const matchStr = typeof ctx.match === 'string' ? ctx.match : ''
  const args = matchStr.trim().split(/\s+/)
  const subcommand = args[0]
  const identifier = args[1]
  if (subcommand === 'add') {
    await handleUserAdd(ctx, userId, identifier)
  } else if (subcommand === 'remove') {
    await handleUserRemove(ctx, userId, identifier, adminUserId)
  } else {
    await ctx.reply('Usage: /user add <id|@username> or /user remove <id|@username>')
  }
}

async function handleUsersCommand(ctx: Context, userId: number, adminUserId: number): Promise<void> {
  const users = listUsers()
  if (users.length === 0) {
    await ctx.reply('No authorized users.')
    return
  }
  const lines = users.map((u) => {
    const admin = u.telegram_id === adminUserId ? ' (admin)' : ''
    const username = u.username === null ? '' : ` (@${u.username})`
    return `${u.telegram_id}${username}${admin} — added ${u.added_at}`
  })
  log.info({ userId }, '/users command executed')
  await ctx.reply(lines.join('\n'))
}

async function provisionUserKaneo(ctx: { reply: (text: string) => Promise<unknown> }, userId: number): Promise<void> {
  const outcome = await provisionAndConfigure(userId, null)
  if (outcome.status === 'provisioned') {
    await ctx.reply(
      `Kaneo account created.\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n🌐 ${outcome.kaneoUrl}`,
    )
  } else if (outcome.status === 'failed') {
    await ctx.reply(`Note: Kaneo auto-provisioning failed (${outcome.error}). User can configure manually via /set.`)
  }
}

async function handleUserAdd(
  ctx: { reply: (text: string) => Promise<unknown> },
  adminId: number,
  identifier: string | undefined,
): Promise<void> {
  if (identifier === undefined || identifier === '') {
    await ctx.reply('Usage: /user add <telegram_user_id|@username>')
    return
  }

  const parsed = parseUserIdentifier(identifier)
  if (parsed === null) {
    await ctx.reply('Invalid identifier. Use numeric ID or @username.')
    return
  }

  if (parsed.type === 'id') {
    addUser(parsed.value, adminId)
    log.info({ adminId, newUserId: parsed.value }, '/user add command executed')
    await ctx.reply(`User ${parsed.value} authorized.`)
    await provisionUserKaneo(ctx, parsed.value)
  } else {
    const placeholderId = -Math.floor(Math.random() * 2_000_000_000) - 1
    addUser(placeholderId, adminId, parsed.value)
    log.info({ adminId, username: parsed.value }, '/user add command executed')
    await ctx.reply(`User @${parsed.value} authorized.`)
  }
}

async function handleUserRemove(
  ctx: { reply: (text: string) => Promise<unknown> },
  adminId: number,
  identifier: string | undefined,
  adminUserId: number,
): Promise<void> {
  if (identifier === undefined || identifier === '') {
    await ctx.reply('Usage: /user remove <telegram_user_id|@username>')
    return
  }

  const parsed = parseUserIdentifier(identifier)
  if (parsed === null) {
    await ctx.reply('Invalid identifier. Use numeric ID or @username.')
    return
  }

  if (parsed.type === 'id' && parsed.value === adminUserId) {
    await ctx.reply('Cannot remove the admin user.')
    return
  }

  removeUser(parsed.type === 'id' ? parsed.value : parsed.value)
  log.info({ adminId, identifier: parsed.value }, '/user remove command executed')
  await ctx.reply(`User ${identifier} removed.`)
}
