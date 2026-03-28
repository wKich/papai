import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ChatProvider, IncomingMessage, ReplyFn } from '../../src/chat/types.js'
import { createDmMessage, createMockReply, mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Setup mocks before importing modules
mockLogger()
mockDrizzle()

// Track processMessage calls
let processMessageCallCount = 0
let lastProcessedStorageId: string | null = null

// Mock processMessage to avoid LLM/config dependencies
void mock.module('../../src/llm-orchestrator.js', () => ({
  processMessage: (_reply: unknown, storageContextId: string): Promise<void> => {
    processMessageCallCount++
    lastProcessedStorageId = storageContextId
    return Promise.resolve()
  },
}))

import { setupBot } from '../../src/bot.js'
import { setConfig } from '../../src/config.js'
import { addUser, isAuthorized, removeUser } from '../../src/users.js'

const ADMIN_ID = 'admin-bot-auth'

// Setup user config to bypass wizard auto-start
function setupUserConfig(userId: string): void {
  setConfig(userId, 'llm_apikey', 'sk-test1234')
  setConfig(userId, 'llm_baseurl', 'https://api.test.com')
  setConfig(userId, 'main_model', 'gpt-4')
  setConfig(userId, 'small_model', 'gpt-4')
  setConfig(userId, 'kaneo_apikey', 'test-kaneo-key')
  setConfig(userId, 'timezone', 'UTC')
}

describe('Bot Authorization Gate', () => {
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(async () => {
    // Setup test database with migrations
    await setupTestDb()

    // Reset call tracking
    processMessageCallCount = 0
    lastProcessedStorageId = null
    messageHandler = null

    const mockChat: ChatProvider = {
      name: 'mock',
      registerCommand: (): void => {},
      onMessage: (handler): void => {
        messageHandler = handler
      },
      sendMessage: (): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }

    setupBot(mockChat, ADMIN_ID)
  })

  describe('Unauthorized user — silent drop', () => {
    test('does not call processMessage for unauthorized user', async () => {
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      await messageHandler!(createDmMessage('unknown-user', 'hello'), reply)
      expect(processMessageCallCount).toBe(0)
    })

    test('does not call reply.text for unauthorized user', async () => {
      expect(messageHandler).not.toBeNull()
      const { reply, textCalls } = createMockReply()
      await messageHandler!(createDmMessage('unknown-user', 'hello'), reply)
      expect(textCalls).toHaveLength(0)
    })
  })

  describe('Authorized user — message processed', () => {
    test('calls processMessage for authorized user', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      await messageHandler!(createDmMessage('auth-user', 'hello'), reply)
      expect(processMessageCallCount).toBe(1)
      expect(lastProcessedStorageId).toBe('auth-user')
    })
  })

  describe('Username resolution on first message', () => {
    test('resolves username to real ID on first message', async () => {
      // Add user by username (placeholder ID, like /user add @newuser)
      addUser('placeholder-uuid', ADMIN_ID, 'newuser')
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      // First message from real user ID with that username
      const msg = createDmMessage('real-555', 'hello', 'newuser')
      setupUserConfig('real-555')
      await messageHandler!(msg, reply)
      expect(processMessageCallCount).toBe(1)
      expect(isAuthorized('real-555')).toBe(true)
    })

    test('subsequent messages from resolved user pass authorization', async () => {
      addUser('placeholder-uuid-2', ADMIN_ID, 'resolveduser')
      expect(messageHandler).not.toBeNull()
      const { reply: reply1 } = createMockReply()
      // First message - resolves username
      const msg1 = createDmMessage('real-666', 'hello', 'resolveduser')
      setupUserConfig('real-666')
      await messageHandler!(msg1, reply1)
      expect(processMessageCallCount).toBe(1)

      // Second message - should use real ID directly
      const { reply: reply2 } = createMockReply()
      const msg2 = createDmMessage('real-666', 'hello', 'resolveduser')
      await messageHandler!(msg2, reply2)
      expect(processMessageCallCount).toBe(2)
    })
  })

  describe('Access revoked during session', () => {
    test('drops message after user is removed', async () => {
      addUser('removable-user', ADMIN_ID)
      setupUserConfig('removable-user')
      expect(messageHandler).not.toBeNull()

      // First message — authorized
      const { reply: reply1 } = createMockReply()
      await messageHandler!(createDmMessage('removable-user', 'hello'), reply1)
      expect(processMessageCallCount).toBe(1)

      // Remove user
      removeUser('removable-user')

      // Second message — should be dropped
      const { reply: reply2, textCalls } = createMockReply()
      await messageHandler!(createDmMessage('removable-user', 'hello'), reply2)
      expect(processMessageCallCount).toBe(1)
      expect(textCalls).toHaveLength(0)
    })
  })
})

afterAll(() => {
  mock.restore()
})
