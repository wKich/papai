import type { ChatProvider, CommandHandler, IncomingMessage, ReplyFn } from '../chat/types.js'
import { logger } from '../logger.js'
import { provisionAndConfigure } from '../providers/kaneo/provision.js'
import { addUser, listUsers, removeUser } from '../users.js'

const log = logger.child({ scope: 'admin' })

const parseUserIdentifier = (
  input: string,
): { type: 'id'; value: string } | { type: 'username'; value: string } | null => {
  const trimmed = input.trim()
  if (trimmed.startsWith('@')) return { type: 'username', value: trimmed.slice(1) }
  // Numeric string ID
  if (/^\d+$/.test(trimmed)) return { type: 'id', value: trimmed }
  // Alphanumeric username without @
  if (/^[a-zA-Z0-9_]+$/.test(trimmed)) return { type: 'username', value: trimmed }
  return null
}

export function registerAdminCommands(chat: ChatProvider, adminUserId: string): void {
  const checkAdmin = (userId: string): boolean => userId === adminUserId

  const userHandler: CommandHandler = async (msg, reply) => {
    // Reject in groups - these commands are only available in direct messages
    if (msg.contextType === 'group') {
      await reply.text('This command is only available in direct messages.')
      return
    }
    if (!checkAdmin(msg.user.id)) {
      await reply.text('Only the admin can manage users.')
      return
    }
    await handleUserCommand(msg, reply, msg.user.id, adminUserId)
  }

  const usersHandler: CommandHandler = async (msg, reply) => {
    // Reject in groups - these commands are only available in direct messages
    if (msg.contextType === 'group') {
      await reply.text('This command is only available in direct messages.')
      return
    }
    if (!checkAdmin(msg.user.id)) {
      await reply.text('Only the admin can list users.')
      return
    }
    await handleUsersCommand(reply, msg.user.id, adminUserId)
  }

  chat.registerCommand('user', userHandler)
  chat.registerCommand('users', usersHandler)
}

async function handleUserCommand(
  msg: IncomingMessage,
  reply: ReplyFn,
  userId: string,
  adminUserId: string,
): Promise<void> {
  const matchStr = msg.commandMatch ?? ''
  const args = matchStr.trim().split(/\s+/)
  const subcommand = args[0]
  const identifier = args[1]
  if (subcommand === 'add') {
    await handleUserAdd(reply, userId, identifier)
  } else if (subcommand === 'remove') {
    await handleUserRemove(reply, userId, identifier, adminUserId)
  } else {
    await reply.text('Usage: /user add <id|@username> or /user remove <id|@username>')
  }
}

async function handleUsersCommand(reply: ReplyFn, userId: string, adminUserId: string): Promise<void> {
  const users = listUsers()
  if (users.length === 0) {
    await reply.text('No authorized users.')
    return
  }
  const lines = users.map((u) => {
    const admin = u.platform_user_id === adminUserId ? ' (admin)' : ''
    const username = u.username === null ? '' : ` (@${u.username})`
    return `${u.platform_user_id}${username}${admin} — added ${u.added_at}`
  })
  log.info({ userId }, '/users command executed')
  await reply.text(lines.join('\n'))
}

async function provisionUserKaneo(reply: ReplyFn, userId: string): Promise<void> {
  const outcome = await provisionAndConfigure(userId, null)
  if (outcome.status === 'provisioned') {
    await reply.text(
      `Kaneo account created.\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n🌐 ${outcome.kaneoUrl}`,
    )
  } else if (outcome.status === 'failed') {
    await reply.text(`Note: Kaneo auto-provisioning failed (${outcome.error}). User can configure manually via /set.`)
  }
}

async function handleUserAdd(reply: ReplyFn, adminId: string, identifier: string | undefined): Promise<void> {
  if (identifier === undefined || identifier === '') {
    await reply.text('Usage: /user add <user_id|@username>')
    return
  }

  const parsed = parseUserIdentifier(identifier)
  if (parsed === null) {
    await reply.text('Invalid identifier. Use numeric ID or @username.')
    return
  }

  if (parsed.type === 'id') {
    addUser(parsed.value, adminId)
    log.info({ adminId, newUserId: parsed.value }, '/user add command executed')
    await reply.text(`User ${parsed.value} authorized.`)
    await provisionUserKaneo(reply, parsed.value)
  } else {
    const placeholderId = `placeholder-${crypto.randomUUID()}`
    addUser(placeholderId, adminId, parsed.value)
    log.info({ adminId, username: parsed.value }, '/user add command executed')
    await reply.text(`User @${parsed.value} authorized.`)
  }
}

async function handleUserRemove(
  reply: ReplyFn,
  adminId: string,
  identifier: string | undefined,
  adminUserId: string,
): Promise<void> {
  if (identifier === undefined || identifier === '') {
    await reply.text('Usage: /user remove <user_id|@username>')
    return
  }

  const parsed = parseUserIdentifier(identifier)
  if (parsed === null) {
    await reply.text('Invalid identifier. Use numeric ID or @username.')
    return
  }

  if (parsed.type === 'id' && parsed.value === adminUserId) {
    await reply.text('Cannot remove the admin user.')
    return
  }

  removeUser(parsed.value)
  log.info({ adminId, identifier: parsed.value }, '/user remove command executed')
  await reply.text(`User ${identifier} removed.`)
}
