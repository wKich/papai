import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatProvider, CommandHandler, ResolveUserContext } from '../../src/chat/types.js'
import { registerGroupCommand } from '../../src/commands/group.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  setupTestDb,
  TELEGRAM_LIKE_CAPABILITIES,
} from '../utils/test-helpers.js'

const getFirstReply = (textCalls: readonly string[]): string | null => {
  const firstReply = textCalls[0]
  if (firstReply === undefined) {
    return null
  }
  return firstReply
}

describe('group commands', () => {
  let mockChat: ChatProvider
  let commandHandlers: Map<string, CommandHandler>
  let lastReply: string | null

  beforeEach(async () => {
    mockLogger()
    // Setup test database with migrations
    await setupTestDb()

    // Setup mock chat provider with custom resolveUserId
    commandHandlers = new Map()
    mockChat = createMockChat({
      commandHandlers,
      resolveUserId: (username: string, _context): Promise<string | null> => {
        const clean = username.startsWith('@') ? username.slice(1) : username
        if (clean === 'user1') return Promise.resolve('user1_id')
        if (clean === 'user2') return Promise.resolve('user2_id')
        if (/^\d+$/.test(clean)) return Promise.resolve(clean)
        return Promise.resolve(null)
      },
    })

    // Register the group command
    registerGroupCommand(mockChat)

    lastReply = null
  })

  describe('adduser', () => {
    test('adds user when admin', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @user1', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('User @user1 added to this group.')
    })

    test('rejects non-admins', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'adduser @user2', false), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Only group admins can add users.')
    })

    test('requires username argument', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('admin1', 'adduser', true), reply, createAuth('admin1', { isGroupAdmin: true }))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Usage: /group adduser <user-id|@username>')
    })

    test('rejects invalid user format', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser invalid@user', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Please provide a valid user mention or ID.')
    })

    test('accepts numeric user ID', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser 12345', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('User 12345 added to this group.')
    })

    test('adduser persists member in DB', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @user1', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      const { listGroupMembers } = await import('../../src/groups.js')
      const members = listGroupMembers('group1')
      // Should store the resolved ID, not the username
      expect(members.some((m) => m.user_id === 'user1_id')).toBe(true)
    })

    test('resolves username to user ID before storing', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @user2', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      const { listGroupMembers } = await import('../../src/groups.js')
      const members = listGroupMembers('group1')
      // Should store the resolved ID, not the username
      expect(members.some((m) => m.user_id === 'user2_id')).toBe(true)
      expect(members.some((m) => m.user_id === 'user2')).toBe(false)
    })

    test('handles unresolved username gracefully', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @unknown_user', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      // With users.resolve capability but null result, should error not fall back
      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe("Couldn't resolve that username. Use an explicit user ID.")

      // No member should have been added
      const { listGroupMembers } = await import('../../src/groups.js')
      const members = listGroupMembers('group1')
      expect(members.some((m) => m.user_id === 'unknown_user')).toBe(false)
    })

    test('passes msg context into ChatProvider.resolveUserId', async () => {
      let lastResolveContext: ResolveUserContext | null = null
      const contextHandlers = new Map<string, CommandHandler>()
      const contextChat = createMockChat({
        commandHandlers: contextHandlers,
        resolveUserId: (_username: string, context: ResolveUserContext): Promise<string | null> => {
          lastResolveContext = context
          return Promise.resolve('resolved-id')
        },
      })
      registerGroupCommand(contextChat)
      const handler = contextHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @alice', true, 'channel-42'),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      expect(lastResolveContext).not.toBeNull()
      expect(lastResolveContext!.contextId).toBe('channel-42')
      expect(lastResolveContext!.contextType).toBe('group')
    })
  })

  describe('deluser', () => {
    test('removes user when admin', async () => {
      // First add a user
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser user1', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('User user1 removed from this group.')
    })

    test('rejects non-admins', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'deluser user2', false), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Only group admins can remove users.')
    })

    test('requires username argument', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('admin1', 'deluser', true), reply, createAuth('admin1', { isGroupAdmin: true }))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Usage: /group deluser <user-id|@username>')
    })

    test('rejects invalid user format', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser invalid@user', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Please provide a valid user mention or ID.')
    })

    test('handles non-existent user gracefully', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser nonexistent', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('User nonexistent removed from this group.')
    })

    test('deluser removes member from DB', async () => {
      const { addGroupMember, listGroupMembers, isGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser user1', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      const members = listGroupMembers('group1')
      expect(members.some((m) => m.user_id === 'user1')).toBe(false)
      expect(isGroupMember('group1', 'user1')).toBe(false)
    })
  })

  describe('users', () => {
    test('lists empty group', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('No members in this group yet.')
    })

    test('lists group members', async () => {
      // Add some users
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')
      addGroupMember('group1', 'user2', 'admin1')

      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toContain('Group members:')
      expect(lastReply).toContain('user1')
      expect(lastReply).toContain('user2')
      expect(lastReply).toContain('added by admin1')
    })

    test('accessible to any member (not just admins)', async () => {
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toContain('Group members:')
    })
  })

  describe('context validation', () => {
    test('rejects non-admin DM add', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('user1', 'add group-123'), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Only bot admins can manage authorized groups.')
    })

    test('rejects non-admin DM list', async () => {
      const groupsHandler = commandHandlers.get('groups')
      expect(groupsHandler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await groupsHandler!(createDmMessage('user1'), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Only bot admins can list authorized groups.')
    })
  })

  describe('DM admin group authorization', () => {
    test('registers separate /groups command', () => {
      expect(commandHandlers.has('groups')).toBe(true)
    })

    test('adds an authorized group in DM for bot admin', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'add group-123'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Group group-123 authorized.')

      const { isAuthorizedGroup } = await import('../../src/authorized-groups.js')
      expect(isAuthorizedGroup('group-123')).toBe(true)
    })

    test('removes an authorized group in DM for bot admin', async () => {
      const { addAuthorizedGroup, isAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')

      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'remove group-123'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Group group-123 removed.')
      expect(isAuthorizedGroup('group-123')).toBe(false)
    })

    test('reports when removing a group that was not authorized', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createDmMessage('admin1', 'remove missing-group'),
        reply,
        createAuth('admin1', { isBotAdmin: true }),
      )

      expect(textCalls[0]).toBe('Group missing-group was not authorized.')
    })

    test('lists authorized groups via /groups for bot admin in DM', async () => {
      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')
      addAuthorizedGroup('group-456', 'admin2')

      const groupsHandler = commandHandlers.get('groups')
      expect(groupsHandler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await groupsHandler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('Authorized groups:')
      expect(textCalls[0]).toContain('group-123')
      expect(textCalls[0]).toContain('group-456')
    })

    test('shows empty authorized group list via /groups', async () => {
      const groupsHandler = commandHandlers.get('groups')
      expect(groupsHandler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await groupsHandler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('No authorized groups.')
    })

    test('requires group id for DM add', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'add'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Usage: /group add <group-id> | /group remove <group-id> | /groups')
    })

    test('requires group id for DM remove', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'remove'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Usage: /group add <group-id> | /group remove <group-id> | /groups')
    })

    test('shows DM admin usage for unknown DM subcommand', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'unknown group-123'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('Unknown subcommand')
      expect(textCalls[0]).toContain('/group add <group-id>')
      expect(textCalls[0]).toContain('/group remove <group-id>')
      expect(textCalls[0]).toContain('/groups')
    })

    test('rejects /groups in group chats', async () => {
      const groupsHandler = commandHandlers.get('groups')
      expect(groupsHandler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await groupsHandler!(createGroupMessage('admin1', '', true), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('This command is only available in direct messages.')
    })
  })

  describe('unknown subcommand', () => {
    test('shows usage for unknown subcommand', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'unknown', false), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toContain('Unknown subcommand')
      expect(lastReply).toContain('Usage: /group adduser <user-id|@username>')
    })

    test('shows usage when no subcommand', async () => {
      const handler = commandHandlers.get('group')

      const message = createGroupMessage('user1', '', false)
      message.commandMatch = ''

      const { reply, textCalls } = createMockReply()
      await handler!(message, reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toContain('Usage: /group adduser <user-id|@username>')
    })
  })

  describe('username resolution capability gating', () => {
    let noResolveChat: ChatProvider
    let noResolveHandlers: Map<string, CommandHandler>

    beforeEach(async () => {
      mockLogger()
      await setupTestDb()

      noResolveHandlers = new Map()
      noResolveChat = createMockChat({
        commandHandlers: noResolveHandlers,
        capabilities: TELEGRAM_LIKE_CAPABILITIES,
      })
      registerGroupCommand(noResolveChat)
    })

    test('adduser @username errors when provider lacks users.resolve', async () => {
      const handler = noResolveHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @someone', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      expect(textCalls[0]).toBe('This chat provider does not support username lookup. Use an explicit user ID.')
    })

    test('deluser @username errors when provider lacks users.resolve', async () => {
      const handler = noResolveHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser @someone', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      expect(textCalls[0]).toBe('This chat provider does not support username lookup. Use an explicit user ID.')
    })

    test('adduser with plain ID still works when provider lacks users.resolve', async () => {
      const handler = noResolveHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser 12345', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      expect(textCalls[0]).toBe('User 12345 added to this group.')
    })
  })

  describe('readable label resolution', () => {
    test('lists authorized groups with resolved group and user labels', async () => {
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveGroupLabel: (groupId: string): Promise<string | null> => {
          if (groupId === 'group-123') return Promise.resolve('Engineering Chat')
          return Promise.resolve(null)
        },
        resolveUserLabel: (userId: string): Promise<string | null> => {
          if (userId === 'admin1') return Promise.resolve('John Johnson (@itsmike)')
          return Promise.resolve(null)
        },
      })
      registerGroupCommand(labeledChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')

      const handler = labeledHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('Engineering Chat')
      expect(textCalls[0]).toContain('John Johnson (@itsmike)')
      expect(textCalls[0]).not.toContain('group-123 (added by admin1)')
    })

    test('resolves added-by labels separately for each authorized group context', async () => {
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveGroupLabel: (groupId: string): Promise<string | null> => Promise.resolve(groupId),
        resolveUserLabel: (userId: string, context?: ResolveUserContext): Promise<string | null> => {
          if (userId !== 'admin1') return Promise.resolve(null)
          if (context?.contextId === 'group-123') return Promise.resolve('Alice One (@admin1)')
          if (context?.contextId === 'group-456') return Promise.resolve('Alice Two (@admin1)')
          return Promise.resolve(null)
        },
      })
      registerGroupCommand(labeledChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')
      addAuthorizedGroup('group-456', 'admin1')

      const handler = labeledHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('group-123 (added by Alice One (@admin1))')
      expect(textCalls[0]).toContain('group-456 (added by Alice Two (@admin1))')
    })

    test('lists group users with resolved member and adder labels', async () => {
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveUserLabel: (userId: string): Promise<string | null> => {
          if (userId === 'user1') return Promise.resolve('John Johnson (@itsmike)')
          if (userId === 'admin1') return Promise.resolve('Jane Admin (@janeadmin)')
          return Promise.resolve(null)
        },
      })
      registerGroupCommand(labeledChat)

      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = labeledHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createAuth('user1'))

      expect(textCalls[0]).toContain('John Johnson (@itsmike)')
      expect(textCalls[0]).toContain('added by Jane Admin (@janeadmin)')
    })

    test('falls back to raw IDs when /groups label resolution returns null', async () => {
      const fallbackHandlers = new Map<string, CommandHandler>()
      const fallbackChat = createMockChat({
        commandHandlers: fallbackHandlers,
        resolveGroupLabel: (_groupId: string): Promise<string | null> => Promise.resolve(null),
        resolveUserLabel: (_userId: string): Promise<string | null> => Promise.resolve(null),
      })
      registerGroupCommand(fallbackChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')

      const handler = fallbackHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('group-123 (added by admin1)')
    })

    test('falls back to raw IDs when /group users label resolution returns null', async () => {
      const fallbackHandlers = new Map<string, CommandHandler>()
      const fallbackChat = createMockChat({
        commandHandlers: fallbackHandlers,
        resolveUserLabel: (_userId: string): Promise<string | null> => Promise.resolve(null),
      })
      registerGroupCommand(fallbackChat)

      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = fallbackHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createAuth('user1'))

      expect(textCalls[0]).toContain('- user1 (added by admin1)')
    })
  })
})
