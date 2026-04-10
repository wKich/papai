import { supportsUserResolution } from '../chat/capabilities.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn } from '../chat/types.js'
import { addGroupMember, listGroupMembers, removeGroupMember } from '../groups.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:group' })

export function registerGroupCommand(chat: ChatProvider): void {
  chat.registerCommand('group', async (msg: IncomingMessage, reply: ReplyFn, _auth: AuthorizationResult) => {
    if (msg.contextType !== 'group') {
      await reply.text('Group commands can only be used in group chats.')
      return
    }

    const match = (msg.commandMatch ?? '').trim()
    if (!match) {
      await reply.text('Usage: /group adduser <@username> | /group deluser <@username> | /group users')
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
        await reply.text('Usage: /group adduser <@username> | /group deluser <@username> | /group users')
        break
      default:
        await reply.text(
          'Unknown subcommand. Usage: /group adduser <@username> | /group deluser <@username> | /group users',
        )
    }
  })
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
    await reply.text('Usage: /group adduser <@username>')
    return
  }

  const result = await extractUserId(chat, targetUser)
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
    await reply.text('Usage: /group deluser <@username>')
    return
  }

  const result = await extractUserId(chat, targetUser)
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
): Promise<{ kind: 'resolved'; userId: string } | { kind: 'error'; message: string }> {
  if (input.startsWith('@')) {
    if (!supportsUserResolution(chat)) {
      return { kind: 'error', message: 'This chat provider does not support username lookup. Use an explicit user ID.' }
    }
    const resolved = await chat.resolveUserId?.(input)
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
