import { beforeEach, describe, expect, test } from 'bun:test'

import { listActiveAttachments, persistIncomingAttachments } from '../../src/attachments/index.js'
import type { ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { registerClearCommand } from '../../src/commands/clear.js'
import { addUser } from '../../src/users.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/clear command — attachment workspace integration', () => {
  let mockChat: ChatProvider
  let commandHandlers: Map<string, CommandHandler>
  const adminUserId = 'admin-clear'

  const checkAuthorization = (userId: string): boolean => userId === adminUserId

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    addUser(adminUserId, adminUserId)

    const { provider, commandHandlers: handlers } = createMockChatWithCommandHandlers()
    mockChat = provider
    commandHandlers = handlers
    registerClearCommand(mockChat, checkAuthorization, adminUserId)
  })

  test('clears the attachment workspace alongside history and memory', async () => {
    addUser('clear-user', adminUserId)
    await persistIncomingAttachments({
      contextId: 'clear-user',
      sourceProvider: 'telegram',
      files: [{ fileId: 'tg-1', filename: 'note.txt', content: Buffer.from('note') }],
    })
    expect(listActiveAttachments('clear-user')).toHaveLength(1)

    const handler = commandHandlers.get('clear')
    expect(handler).toBeDefined()
    const auth = createAuth('clear-user')
    auth.storageContextId = 'clear-user'

    const msg = createDmMessage('clear-user', '')

    const { reply, textCalls } = createMockReply()
    await handler!(msg, reply, auth)

    expect(listActiveAttachments('clear-user')).toEqual([])
    expect(textCalls[0]).toContain('attachments')
  })

  test('clears workspace for a target user when admin runs /clear <user_id>', async () => {
    addUser('victim-user', adminUserId)
    await persistIncomingAttachments({
      contextId: 'victim-user',
      sourceProvider: 'telegram',
      files: [{ fileId: 'tg-1', filename: 'a.txt', content: Buffer.from('a') }],
    })
    expect(listActiveAttachments('victim-user')).toHaveLength(1)

    const handler = commandHandlers.get('clear')
    const adminMsg = createDmMessage(adminUserId, '/clear victim-user')
    adminMsg.commandMatch = 'victim-user'
    const auth = createAuth(adminUserId, { isBotAdmin: true })

    const { reply, textCalls } = createMockReply()
    await handler!(adminMsg, reply, auth)

    expect(listActiveAttachments('victim-user')).toEqual([])
    expect(textCalls[0]).toContain('attachments')
  })
})
