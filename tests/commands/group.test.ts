import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatProvider, CommandHandler, IncomingMessage } from '../../src/chat/types.js'
import { registerGroupCommand } from '../../src/commands/group.js'
import {
  createAuth,
  createGroupMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

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
      resolveUserId: (username: string): Promise<string | null> => {
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

      lastReply = textCalls[0] ?? null
      expect(lastReply).toBe('User @user1 added to this group.')
    })

    test('rejects non-admins', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'adduser @user2', false), reply, createAuth('user1'))

      lastReply = textCalls[0] ?? null
      expect(lastReply).toBe('Only group admins can add users.')
    })

    test('requires username argument', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('admin1', 'adduser', true), reply, createAuth('admin1', { isGroupAdmin: true }))

      lastReply = textCalls[0] ?? null
      expect(lastReply).toBe('Usage: /group adduser <@username>')
    })

    test('rejects invalid user format', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser invalid@user', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      lastReply = textCalls[0] ?? null
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

      lastReply = textCalls[0] ?? null
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

      // Should still add with the raw value (input.slice(1)) when resolver returns null
      lastReply = textCalls[0] ?? null
      expect(lastReply).toBe('User @unknown_user added to this group.')

      // Verify the null-fallback path: stored ID must be the sliced username, not '@unknown_user'
      const { listGroupMembers } = await import('../../src/groups.js')
      const members = listGroupMembers('group1')
      expect(members.some((m) => m.user_id === 'unknown_user')).toBe(true)
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

      lastReply = textCalls[0] ?? null
      expect(lastReply).toBe('User user1 removed from this group.')
    })

    test('rejects non-admins', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'deluser user2', false), reply, createAuth('user1'))

      lastReply = textCalls[0] ?? null
      expect(lastReply).toBe('Only group admins can remove users.')
    })

    test('requires username argument', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('admin1', 'deluser', true), reply, createAuth('admin1', { isGroupAdmin: true }))

      lastReply = textCalls[0] ?? null
      expect(lastReply).toBe('Usage: /group deluser <@username>')
    })

    test('rejects invalid user format', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser invalid@user', true),
        reply,
        createAuth('admin1', { isGroupAdmin: true }),
      )

      lastReply = textCalls[0] ?? null
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

      lastReply = textCalls[0] ?? null
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

      lastReply = textCalls[0] ?? null
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

      lastReply = textCalls[0] ?? null
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

      lastReply = textCalls[0] ?? null
      expect(lastReply).toContain('Group members:')
    })
  })

  describe('context validation', () => {
    test('rejects in DM context', async () => {
      const handler = commandHandlers.get('group')

      const dmMessage: IncomingMessage = {
        user: {
          id: 'user1',
          username: 'testuser',
          isAdmin: true,
        },
        contextId: 'user1',
        contextType: 'dm',
        isMentioned: false,
        text: '/group users',
        commandMatch: 'users',
      }

      const { reply, textCalls } = createMockReply()
      await handler!(dmMessage, reply, createAuth('admin1', { isGroupAdmin: true }))

      lastReply = textCalls[0] ?? null
      expect(lastReply).toBe('Group commands can only be used in group chats.')
    })
  })

  describe('unknown subcommand', () => {
    test('shows usage for unknown subcommand', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'unknown', false), reply, createAuth('user1'))

      lastReply = textCalls[0] ?? null
      expect(lastReply).toContain('Unknown subcommand')
      expect(lastReply).toContain('Usage: /group adduser')
    })

    test('shows usage when no subcommand', async () => {
      const handler = commandHandlers.get('group')

      const message = createGroupMessage('user1', '', false)
      message.commandMatch = ''

      const { reply, textCalls } = createMockReply()
      await handler!(message, reply, createAuth('user1'))

      lastReply = textCalls[0] ?? null
      expect(lastReply).toContain('Usage: /group adduser')
    })
  })
})
