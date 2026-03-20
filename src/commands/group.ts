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
        await handleAddUser(msg, reply, targetUser)
        break
      case 'deluser':
        await handleDelUser(msg, reply, targetUser)
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

  const userId = extractUserId(targetUser)
  if (userId === null) {
    await reply.text('Please provide a valid user mention or ID.')
    return
  }

  addGroupMember(msg.contextId, userId, msg.user.id)
  await reply.text(`User ${targetUser} added to this group.`)
  log.info({ groupId: msg.contextId, userId }, 'Group member added')
}

async function handleDelUser(
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

  const userId = extractUserId(targetUser)
  if (userId === null) {
    await reply.text('Please provide a valid user mention or ID.')
    return
  }

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

function extractUserId(input: string): string | null {
  if (input.startsWith('@')) {
    return input.slice(1)
  }
  if (/^\d+$/.test(input) || /^[a-zA-Z0-9_-]+$/.test(input)) {
    return input
  }
  return null
}
