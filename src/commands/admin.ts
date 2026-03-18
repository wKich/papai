import type { Bot, Context } from 'grammy'

import { setConfig } from '../config.js'
import { logger } from '../logger.js'
import { createBackup, getLastBackupPath, restoreBackup, runMigration, type MigrationUserResult } from '../migration.js'
import { addUser, listUsers, removeUser, setKaneoWorkspace } from '../users.js'

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

  bot.command('migrate', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAdmin(userId)) {
      await ctx.reply('Only the admin can run migrations.')
      return
    }
    await handleMigrateCommand(ctx)
  })

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

async function handleMigrateCommand(ctx: Context): Promise<void> {
  const matchStr = typeof ctx.match === 'string' ? ctx.match : ''
  const parts = matchStr.trim().split(/\s+/)
  const subcommand = parts[0]
  const rawUserId = parts[1]
  const targetUserId = rawUserId !== undefined && /^\d+$/.test(rawUserId) ? Number(rawUserId) : undefined
  if (subcommand === 'dryrun') {
    await handleMigrateDryrun(ctx, targetUserId)
  } else if (subcommand === 'run') {
    await handleMigrateRun(ctx, targetUserId)
  } else if (subcommand === 'rollback') {
    const backupArg = parts[1]
    await handleMigrateRollback(ctx, backupArg)
  } else {
    await ctx.reply('Usage:\n/migrate dryrun [user_id]\n/migrate run [user_id]\n/migrate rollback [backup_path]')
  }
}

function formatMigrationResults(results: MigrationUserResult[]): string {
  if (results.length === 0) return 'No users found to migrate.'
  return results
    .map((r) => {
      const label = r.username === null ? String(r.userId) : `@${r.username}`
      if (r.status === 'success' && r.stats !== undefined) {
        const s = r.stats
        return `✓ ${label}: ${s.tasks} tasks, ${s.projects} projects, ${s.comments} comments`
      }
      return `${r.status.startsWith('failed') ? '✗' : '~'} ${label}: ${r.status}`
    })
    .join('\n')
}

let migrationRunning = false

async function handleMigrateDryrun(ctx: Context, singleUserId: number | undefined): Promise<void> {
  log.info({ singleUserId }, '/migrate dryrun called')
  const msg = await ctx.reply('Running dry run...')
  try {
    const results = await runMigration({ dryRun: true, singleUserId })
    const summary = formatMigrationResults(results)
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Dry run complete:\n\n${summary}`)
    log.info({ singleUserId }, '/migrate dryrun complete')
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : String(error)
    log.error({ error: err }, '/migrate dryrun failed')
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Dry run failed: ${err}`)
  }
}

function buildCredentialsDm(kaneoEmail: string, kaneoPassword: string, webUrl: string | null): string {
  const urlLine = webUrl === null ? '' : `\n🌐 Kaneo web: ${webUrl}`
  return (
    `✅ Your data has been migrated from Linear to Kaneo!${urlLine}\n` +
    `📧 Email: ${kaneoEmail}\n` +
    `🔑 Password: ${kaneoPassword}\n\n` +
    `The bot is already configured and ready to use.`
  )
}

async function notifyProvisionedUsers(
  ctx: Context,
  results: MigrationUserResult[],
  webUrl: string | null,
): Promise<void> {
  const provisioned = results.filter((r) => r.kaneoEmail !== undefined && r.kaneoPassword !== undefined)
  await Promise.all(
    provisioned.map(async (result) => {
      try {
        const dm = buildCredentialsDm(result.kaneoEmail!, result.kaneoPassword!, webUrl)
        await ctx.api.sendMessage(result.userId, dm)
        log.info({ userId: result.userId }, 'Credentials DM sent to provisioned user')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn({ userId: result.userId, error: msg }, 'Failed to send credentials DM')
      }
    }),
  )
}

async function handleMigrateRun(ctx: Context, singleUserId: number | undefined): Promise<void> {
  if (migrationRunning) {
    await ctx.reply('A migration is already in progress.')
    return
  }
  migrationRunning = true
  log.info({ singleUserId }, '/migrate run called')
  const kaneoUrl = process.env['KANEO_CLIENT_URL']
  const kaneoInternalUrl = process.env['KANEO_INTERNAL_URL']
  const lines: string[] = ['Creating backup...']
  const msg = await ctx.reply(lines.join('\n'))
  const appendLine = async (line: string): Promise<void> => {
    lines.push(line)
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, lines.join('\n'))
  }
  try {
    const backupPath = createBackup()
    await appendLine(`Backup saved. Starting migration...`)
    const results = await runMigration({ clearHistory: true, singleUserId, kaneoUrl, kaneoInternalUrl }, appendLine)
    const failed = results.filter((r) => r.status.startsWith('failed')).length
    const provisionedCount = results.filter((r) => r.kaneoEmail !== undefined).length
    const footer =
      failed > 0
        ? `\n${failed} user(s) failed — use /migrate rollback to restore.`
        : `\nHistory cleared. Backup: ${backupPath}`
    const provisionNote = provisionedCount > 0 ? `\n${provisionedCount} account(s) auto-provisioned — DMs sent.` : ''
    await appendLine(`Migration complete.${footer}${provisionNote}`)
    await notifyProvisionedUsers(ctx, results, kaneoUrl ?? null)
    log.info({ singleUserId }, '/migrate run complete')
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : String(error)
    log.error({ error: err }, '/migrate run failed')
    await appendLine(`Migration failed: ${err}\nUse /migrate rollback to restore the backup.`)
  } finally {
    migrationRunning = false
  }
}

async function handleMigrateRollback(ctx: Context, backupArg: string | undefined): Promise<void> {
  const backupPath = backupArg ?? getLastBackupPath()
  if (backupPath === undefined) {
    await ctx.reply(
      'No backup available. Provide a path: /migrate rollback <backup_path>\nOr run /migrate run first (backup is created automatically).',
    )
    return
  }
  log.info({ backupPath }, '/migrate rollback called')
  const msg = await ctx.reply(`Rolling back to ${backupPath}...`)
  try {
    await restoreBackup(backupPath)
    await ctx.api.editMessageText(
      ctx.chat!.id,
      msg.message_id,
      `Rollback complete. Database restored from ${backupPath}.\nNote: data already written to Kaneo is not reversed.`,
    )
    log.info({ backupPath }, '/migrate rollback complete')
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : String(error)
    log.error({ backupPath, error: err }, '/migrate rollback failed')
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Rollback failed: ${err}`)
  }
}

async function provisionUserKaneo(ctx: { reply: (text: string) => Promise<unknown> }, userId: number): Promise<void> {
  const kaneoUrl = process.env['KANEO_CLIENT_URL']
  if (kaneoUrl === undefined) return
  try {
    const { provisionKaneoUser } = await import('../providers/kaneo/provision.js')
    const kaneoInternalUrl = process.env['KANEO_INTERNAL_URL'] ?? kaneoUrl
    const prov = await provisionKaneoUser(kaneoInternalUrl, kaneoUrl, userId, null)
    setConfig(userId, 'kaneo_apikey', prov.kaneoKey)
    setKaneoWorkspace(userId, prov.workspaceId)
    log.info({ userId }, 'Kaneo account provisioned for new user')
    await ctx.reply(`Kaneo account created.\n📧 Email: ${prov.email}\n🔑 Password: ${prov.password}\n🌐 ${kaneoUrl}`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn({ userId, error: msg }, 'Kaneo provisioning failed for new user')
    await ctx.reply(`Note: Kaneo auto-provisioning failed (${msg}). User can configure manually via /set.`)
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
