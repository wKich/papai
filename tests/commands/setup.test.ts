import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerSetupCommand } from '../../src/commands/setup.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/setup command', () => {
  let setupHandler: CommandHandler | null = null

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerSetupCommand(provider, (_userId: string) => true)
    setupHandler = commandHandlers.get('setup') ?? null
  })

  test('starts with a personal/group selector in DM', async () => {
    expect(setupHandler).not.toBeNull()
    const { reply, buttonCalls } = createMockReply()

    await setupHandler!(createDmMessage('user-1'), reply, createAuth('user-1'))

    expect(buttonCalls[0]).toContain('What do you want to configure?')
  })

  test('group admin gets a DM-only redirect', async () => {
    expect(setupHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()

    await setupHandler!(
      createGroupMessage('user-1', '/setup', true, 'group-1'),
      reply,
      createAuth('user-1', { isGroupAdmin: true }),
    )

    expect(textCalls[0]).toBe(
      'Group settings are configured in direct messages with the bot. Open a DM with me and run /setup.',
    )
  })

  test('non-admin group user gets the admin-only restriction', async () => {
    expect(setupHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()

    await setupHandler!(createGroupMessage('user-1', '/setup', false, 'group-1'), reply, createAuth('user-1'))

    expect(textCalls[0]).toBe(
      'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
    )
  })
})
