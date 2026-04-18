import { addAuthorizedGroup, listAuthorizedGroups, removeAuthorizedGroup } from '../authorized-groups.js'
import { supportsUserResolution } from '../chat/capabilities.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn, ResolveUserContext } from '../chat/types.js'
import { addGroupMember, listGroupMembers, removeGroupMember } from '../groups.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:group' })

const GROUP_CHAT_USAGE = 'Usage: /group adduser <user-id|@username> | /group deluser <user-id|@username> | /group users'
const DM_ADMIN_USAGE = 'Usage: /group add <group-id> | /group remove <group-id> | /groups'

export function registerGroupCommand(chat: ChatProvider): void {
  chat.registerCommand('group', async (msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => {
    if (msg.contextType === 'dm') {
      await handleAuthorizedGroupCommand(msg, reply, auth)
      return
    }

    await handleGroupMemberCommand(chat, msg, reply)
  })

  chat.registerCommand('groups', async (msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => {
    if (msg.contextType !== 'dm') {
      await reply.text('This command is only available in direct messages.')
      return
    }

    if (!auth.isBotAdmin) {
      await reply.text('Only bot admins can list authorized groups.')
      return
    }

    const groups = listAuthorizedGroups()
    if (groups.length === 0) {
      await reply.text('No authorized groups.')
      return
    }

    const lines = groups.map((group) => `${group.group_id} (added by ${group.added_by})`)
    await reply.text(`Authorized groups:\n${lines.join('\n')}`)
  })
}

async function handleGroupMemberCommand(chat: ChatProvider, msg: IncomingMessage, reply: ReplyFn): Promise<void> {
  const match = typeof msg.commandMatch === 'string' ? msg.commandMatch.trim() : ''
  if (!match) {
    await reply.text(GROUP_CHAT_USAGE)
    return
  }

  const [subcommand, ...args] = match.split(/\s+/)
  const targetUser = args[0]

  switch (subcommand) {
    case 'adduser':
      await handleAddUser(chat, msg, reply, targetUser)
      break
    case 'deluser':
      await handleDelUser(chat, msg, reply, targetUser)
      break
    case 'users':
      await handleListUsers(msg, reply)
      break
    case '':
    case undefined:
      await reply.text(GROUP_CHAT_USAGE)
      break
    default:
      await reply.text(`Unknown subcommand. ${GROUP_CHAT_USAGE}`)
  }
}

async function handleAuthorizedGroupCommand(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<void> {
  if (!auth.isBotAdmin) {
    await reply.text('Only bot admins can manage authorized groups.')
    return
  }

  const match = typeof msg.commandMatch === 'string' ? msg.commandMatch.trim() : ''
  if (!match) {
    await reply.text(DM_ADMIN_USAGE)
    return
  }

  const [subcommand, groupId] = match.split(/\s+/, 2)

  if (groupId === undefined || groupId === '') {
    await reply.text(DM_ADMIN_USAGE)
    return
  }

  if (subcommand === 'add') {
    addAuthorizedGroup(groupId, msg.user.id)
    await reply.text(`Group ${groupId} authorized.`)
    log.info({ groupId, userId: msg.user.id }, 'Authorized group added')
    return
  }

  if (subcommand === 'remove') {
    const removed = removeAuthorizedGroup(groupId)
    await reply.text(removed ? `Group ${groupId} removed.` : `Group ${groupId} was not authorized.`)
    log.info({ groupId, userId: msg.user.id, removed }, 'Authorized group removal attempted')
    return
  }

  await reply.text(`Unknown subcommand. ${DM_ADMIN_USAGE}`)
}

async function handleAddUser(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  targetUser: string | undefined,
): Promise<void> {
  if (!msg.user.isAdmin) {
    await reply.text('Only group admins can add users.')
    return
  }

  if (targetUser === undefined) {
    await reply.text('Usage: /group adduser <user-id|@username>')
    return
  }

  const result = await extractUserId(chat, targetUser, {
    contextId: msg.contextId,
    contextType: msg.contextType,
  })
  if (result.kind === 'error') {
    await reply.text(result.message)
    return
  }

  const { userId } = result
  addGroupMember(msg.contextId, userId, msg.user.id)
  await reply.text(`User ${targetUser} added to this group.`)
  log.info({ groupId: msg.contextId, userId }, 'Group member added')
}

async function handleDelUser(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  targetUser: string | undefined,
): Promise<void> {
  if (!msg.user.isAdmin) {
    await reply.text('Only group admins can remove users.')
    return
  }

  if (targetUser === undefined) {
    await reply.text('Usage: /group deluser <user-id|@username>')
    return
  }

  const result = await extractUserId(chat, targetUser, {
    contextId: msg.contextId,
    contextType: msg.contextType,
  })
  if (result.kind === 'error') {
    await reply.text(result.message)
    return
  }

  const { userId } = result
  removeGroupMember(msg.contextId, userId)
  await reply.text(`User ${targetUser} removed from this group.`)
  log.info({ groupId: msg.contextId, userId }, 'Group member removed')
}

async function handleListUsers(msg: IncomingMessage, reply: ReplyFn): Promise<void> {
  const members = listGroupMembers(msg.contextId)

  if (members.length === 0) {
    await reply.text('No members in this group yet.')
    return
  }

  const memberList = members.map((m) => `- ${m.user_id} (added by ${m.added_by})`).join('\n')
  await reply.text(`Group members:\n${memberList}`)
}

async function extractUserId(
  chat: ChatProvider,
  input: string,
  context: ResolveUserContext,
): Promise<{ kind: 'resolved'; userId: string } | { kind: 'error'; message: string }> {
  if (input.startsWith('@')) {
    if (!supportsUserResolution(chat)) {
      return { kind: 'error', message: 'This chat provider does not support username lookup. Use an explicit user ID.' }
    }
    const resolveUserId = chat.resolveUserId
    if (resolveUserId === undefined) {
      return { kind: 'error', message: 'This chat provider does not support username lookup. Use an explicit user ID.' }
    }
    const resolved = await resolveUserId(input, context)
    if (resolved === null || resolved === undefined) {
      return { kind: 'error', message: "Couldn't resolve that username. Use an explicit user ID." }
    }
    return { kind: 'resolved', userId: resolved }
  }
  if (/^\d+$/.test(input) || /^[a-zA-Z0-9_-]+$/.test(input)) {
    return { kind: 'resolved', userId: input }
  }
  return { kind: 'error', message: 'Please provide a valid user mention or ID.' }
}
