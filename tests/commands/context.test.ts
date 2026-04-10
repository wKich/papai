import { beforeEach, describe, expect, test } from 'bun:test'

import type { AuthorizationResult, ChatCapability, CommandHandler } from '../../src/chat/types.js'
import { registerContextCommand } from '../../src/commands/context.js'
import {
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

const ADMIN_ID = 'context-admin'

function createAdminAuth(): AuthorizationResult {
  return {
    allowed: true,
    isBotAdmin: true,
    isGroupAdmin: false,
    storageContextId: ADMIN_ID,
  }
}

describe('/context command', () => {
  let contextHandler: CommandHandler | null

  describe('when provider supports file replies', () => {
    beforeEach(async () => {
      mockLogger()
      await setupTestDb()
      const { provider, commandHandlers } = createMockChatWithCommandHandlers()
      registerContextCommand(provider, ADMIN_ID)
      contextHandler = commandHandlers.get('context') ?? null
    })

    test('rejects non-admin user', async () => {
      expect(contextHandler).not.toBeNull()
      const { reply, textCalls } = createMockReply()
      await contextHandler!(createDmMessage('other-user'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(textCalls[0]).toContain('Only the admin')
    })

    test('sends context as file when file replies are supported', async () => {
      expect(contextHandler).not.toBeNull()
      const { reply, fileCalls } = createMockReply()
      await contextHandler!(createDmMessage(ADMIN_ID), reply, createAdminAuth())
      expect(fileCalls).toHaveLength(1)
      expect(fileCalls[0]?.filename).toBe('context.txt')
    })
  })

  describe('when provider lacks file reply support', () => {
    beforeEach(async () => {
      mockLogger()
      await setupTestDb()
      const capabilities = new Set<ChatCapability>([
        'commands.menu',
        'interactions.callbacks',
        'messages.buttons',
        'messages.redact',
        'files.receive',
        'messages.reply-context',
        'users.resolve',
        // messages.files intentionally omitted
      ])
      const { provider, commandHandlers } = createMockChatWithCommandHandlers({ capabilities })
      registerContextCommand(provider, ADMIN_ID)
      contextHandler = commandHandlers.get('context') ?? null
    })

    test('replies with warning text instead of sending a file', async () => {
      expect(contextHandler).not.toBeNull()
      const { reply, textCalls, fileCalls } = createMockReply()
      await contextHandler!(createDmMessage(ADMIN_ID), reply, createAdminAuth())
      expect(fileCalls).toHaveLength(0)
      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toContain('not supported')
    })
  })
})
