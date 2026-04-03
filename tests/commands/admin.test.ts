import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { registerAdminCommands } from '../../src/commands/admin.js'
import * as schema from '../../src/db/schema.js'
import { addUser, isAuthorized, listUsers } from '../../src/users.js'
import {
  createDmMessage,
  createGroupMessage,
  createMockReply,
  getTestDb,
  mockDrizzle,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

// Mock logger at top of file
mockLogger()

// Mock getDrizzleDb BEFORE importing source modules
mockDrizzle()

// Mock provisionAndConfigure with mutable implementation
type ProvisionResult = {
  status: string
  email?: string
  password?: string
  kaneoUrl?: string
  apiKey?: string
  workspaceId?: string
  error?: string
}
let provisionImpl = (): Promise<ProvisionResult> => Promise.resolve({ status: 'skipped' })

void mock.module('../../src/providers/kaneo/provision.js', () => ({
  provisionAndConfigure: (..._args: unknown[]): Promise<ProvisionResult> => provisionImpl(),
}))

const ADMIN_ID = 'admin-001'

// Helper to create a mock ChatProvider with custom sendMessage behavior and capture handlers
function createMockChatWithHandler(sendMessageImpl: (userId: string, markdown: string) => Promise<void>): {
  mockChat: ChatProvider
  handlers: Map<string, CommandHandler>
} {
  const handlers = new Map<string, CommandHandler>()
  const mockChat: ChatProvider = {
    name: 'mock',
    registerCommand: (name: string, handler: CommandHandler): void => {
      handlers.set(name, handler)
    },
    onMessage: (): void => {},
    sendMessage: sendMessageImpl,
    start: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }
  return { mockChat, handlers }
}

describe('Admin Commands', () => {
  let commandHandlers: Map<string, CommandHandler>

  beforeEach(async () => {
    await setupTestDb()

    // Add admin user to DB
    addUser(ADMIN_ID, ADMIN_ID)

    // Reset provision mock to default
    provisionImpl = (): Promise<ProvisionResult> => Promise.resolve({ status: 'skipped' })

    commandHandlers = new Map()
    const mockChat: ChatProvider = {
      name: 'mock',
      registerCommand: (name: string, handler: CommandHandler): void => {
        commandHandlers.set(name, handler)
      },
      onMessage: (): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }
    registerAdminCommands(mockChat, ADMIN_ID)
  })

  describe('/user add', () => {
    test('adds user by numeric ID and confirms', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add 123456'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('123456 authorized.')
      expect(isAuthorized('123456')).toBe(true)
    })

    test('adds user by @username and confirms', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add @alice'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('@alice authorized.')
      const users = listUsers()
      expect(users.some((u) => u.username === 'alice')).toBe(true)
    })

    test('rejects non-admin caller', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      addUser('other-user', ADMIN_ID)
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', 'add 999'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can manage users.')
      expect(isAuthorized('999')).toBe(false)
    })

    test('shows usage when identifier is missing', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('Usage: /user add')
    })

    test('provision success replies with email, password, and URL', async () => {
      provisionImpl = (): Promise<ProvisionResult> =>
        Promise.resolve({
          status: 'provisioned',
          email: 'bot-user@test.com',
          password: 'abc123',
          kaneoUrl: 'https://kaneo.test',
          apiKey: 'key',
          workspaceId: 'ws-1',
        })

      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add 12345'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      const replies = getReplies()
      expect(replies.some((r) => r.includes('bot-user@test.com'))).toBe(true)
      expect(replies.some((r) => r.includes('abc123'))).toBe(true)
      expect(replies.some((r) => r.includes('kaneo.test'))).toBe(true)
      expect(isAuthorized('12345')).toBe(true)
    })

    test('provision failure replies with failure note', async () => {
      provisionImpl = (): Promise<ProvisionResult> =>
        Promise.resolve({ status: 'failed', error: 'KANEO_CLIENT_URL not set' })

      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add 67890'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      const replies = getReplies()
      expect(replies.some((r) => r.includes('auto-provisioning failed'))).toBe(true)
      expect(isAuthorized('67890')).toBe(true)
    })

    test('rejects invalid identifier format with specific error', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add some@invalid!id'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('Invalid identifier')
      expect(isAuthorized('some@invalid!id')).toBe(false)
    })
  })

  describe('/user remove', () => {
    test('removes user by ID and confirms', async () => {
      addUser('999', ADMIN_ID)
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'remove 999'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('removed')
      expect(isAuthorized('999')).toBe(false)
    })

    test('removes user by @username and confirms', async () => {
      addUser('placeholder-bob', ADMIN_ID, 'bob')
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'remove @bob'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('removed')
      expect(listUsers().some((u) => u.username === 'bob')).toBe(false)
    })

    test('blocks admin from removing themselves', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, `remove ${ADMIN_ID}`), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toBe('Cannot remove the admin user.')
      expect(isAuthorized(ADMIN_ID)).toBe(true)
    })

    test('rejects non-admin caller', async () => {
      addUser('other-user', ADMIN_ID)
      addUser('victim', ADMIN_ID)
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', 'remove victim'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can manage users.')
      expect(isAuthorized('victim')).toBe(true)
    })

    test('returns not found when user does not exist', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'remove nonexistent-user'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toBe('User nonexistent-user not found.')
    })
  })

  describe('/users', () => {
    test('lists all authorized users', async () => {
      addUser('user-a', ADMIN_ID)
      addUser('user-b', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, ''), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('user-a')
      expect(getReplies()[0]).toContain('user-b')
    })

    test('shows empty message when no users except admin', async () => {
      // Delete all users to simulate empty state
      getTestDb().delete(schema.users).run()
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, ''), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toBe('No authorized users.')
    })

    test('rejects non-admin caller', async () => {
      addUser('other-user', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', ''), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can list users.')
    })
  })

  describe('/announce', () => {
    test('sends announcement to all registered users', async () => {
      addUser('user-a', ADMIN_ID)
      addUser('user-b', ADMIN_ID)
      const sentMessages: Array<{ userId: string; markdown: string }> = []
      const { mockChat, handlers } = createMockChatWithHandler((userId, markdown) => {
        sentMessages.push({ userId, markdown })
        return Promise.resolve()
      })
      registerAdminCommands(mockChat, ADMIN_ID)
      const handler = handlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'Hello everyone!'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      // Should send to all users (admin + user-a + user-b)
      expect(sentMessages.length).toBe(3)
      expect(sentMessages.every((m) => m.markdown.includes('Hello everyone!'))).toBe(true)
      // Should confirm to admin
      expect(getReplies()[0]).toContain('3')
    })

    test('rejects non-admin caller', async () => {
      addUser('other-user', ADMIN_ID)
      const handler = commandHandlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', 'Hello'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can send announcements.')
    })

    test('rejects in group context', async () => {
      const handler = commandHandlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createGroupMessage(ADMIN_ID, 'Hello', false, 'group-1'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'group-1',
      })
      expect(getReplies()[0]).toBe('This command is only available in direct messages.')
    })

    test('shows usage when message is empty', async () => {
      const handler = commandHandlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, ''), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('Usage:')
    })

    test('handles send failures gracefully', async () => {
      addUser('user-a', ADMIN_ID)
      addUser('user-b', ADMIN_ID)
      const sentMessages: string[] = []
      const { mockChat, handlers } = createMockChatWithHandler((userId) => {
        if (userId === 'user-a') {
          return Promise.reject(new Error('User blocked bot'))
        }
        sentMessages.push(userId)
        return Promise.resolve()
      })
      registerAdminCommands(mockChat, ADMIN_ID)
      const handler = handlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'Important update'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      // Should report partial success (2 out of 3 sent - admin + user-b, user-a failed)
      const replyText = getReplies()[0]
      expect(replyText).toContain('2')
      expect(replyText).toContain('1')
    })

    test('reports when no users exist', async () => {
      getTestDb().delete(schema.users).run()
      const handler = commandHandlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'Hello'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('No authorized users')
    })

    test('skips placeholder users when sending announcements', async () => {
      addUser('user-a', ADMIN_ID)
      // Add a placeholder (username-only authorization, no real platform ID)
      addUser(`placeholder-${crypto.randomUUID()}`, ADMIN_ID, 'pending-user')
      const sentUserIds: string[] = []
      const { mockChat, handlers } = createMockChatWithHandler((userId) => {
        sentUserIds.push(userId)
        return Promise.resolve()
      })
      registerAdminCommands(mockChat, ADMIN_ID)
      const handler = handlers.get('announce')
      expect(handler).toBeDefined()
      const { reply } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'Hello'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      // Placeholder ID should not be in sent messages
      expect(sentUserIds.every((id) => !id.startsWith('placeholder-'))).toBe(true)
      // Only admin + user-a should receive the message
      expect(sentUserIds.length).toBe(2)
    })
  })
})

afterAll(() => {
  mock.restore()
})
