import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatCapability, CommandHandler } from '../../src/chat/types.js'
import { registerHelpCommand } from '../../src/commands/help.js'
import {
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  mockLogger,
} from '../utils/test-helpers.js'

describe('help command', () => {
  let capturedText: string | null = null
  let lastHandler: CommandHandler | null = null

  const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()

  const mockReply = {
    text: (content: string): Promise<void> => {
      capturedText = content
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    buttons: (): Promise<void> => Promise.resolve(),
  }

  beforeEach(() => {
    mockLogger()
    capturedText = null
    lastHandler = null
    registerHelpCommand(mockChat)
    lastHandler = commandHandlers.get('help') ?? null
  })

  test('DM help shows user management commands for admin', async () => {
    const dmMsg = createDmMessage('user1', '/help')

    const auth = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }

    await lastHandler!(dmMsg, mockReply, auth)

    expect(capturedText).toContain('/user add')
    expect(capturedText).toContain('/user remove')
    expect(capturedText).toContain('/users')
    expect(capturedText).toContain('/setup')
    expect(capturedText).toContain('/config')
    expect(capturedText).toContain('/clear')
    expect(capturedText).toContain('/context')
  })

  test('DM help shows basic commands for non-admin', async () => {
    const dmMsg = createDmMessage('user1', '/help')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }

    await lastHandler!(dmMsg, mockReply, auth)

    expect(capturedText).toContain('/help')
    expect(capturedText).toContain('/setup')
    expect(capturedText).toContain('/config')
    expect(capturedText).toContain('/clear')
    expect(capturedText).not.toContain('/user add')
    expect(capturedText).not.toContain('Admin commands:')
  })

  test('Group help shows group commands', async () => {
    const groupMsg = createGroupMessage('user1', '/help', false, 'group1')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'group1',
    }

    await lastHandler!(groupMsg, mockReply, auth)

    expect(capturedText).toContain('/group adduser')
    expect(capturedText).toContain('/group deluser')
    expect(capturedText).toContain('/group users')
    expect(capturedText).toContain('@botname')
    // Not shown to regular members
    expect(capturedText).not.toContain('/setup')
    expect(capturedText).not.toContain('Admin commands:')
  })

  test('Group admin help includes config commands', async () => {
    const groupMsg = createGroupMessage('admin1', '/help', true, 'group1')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: true,
      storageContextId: 'group1',
    }

    await lastHandler!(groupMsg, mockReply, auth)

    expect(capturedText).toContain('/setup')
    expect(capturedText).toContain('/config')
    expect(capturedText).toContain('/clear')
    expect(capturedText).toContain('Admin commands:')
  })
})

describe('buildHelpText', () => {
  test('/help on provider without file support appends a /context deferral note for admin', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const noFileCapabilities = new Set<ChatCapability>(['interactions.callbacks', 'messages.buttons', 'users.resolve'])
    const noFileHelp = buildHelpText(noFileCapabilities, 'dm', { isBotAdmin: true, isGroupAdmin: false })

    expect(noFileHelp).toContain('/context')
    expect(noFileHelp).toContain('deferred')
  })

  test('/help on provider without file support does NOT mention /context for non-admin', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const noFileCapabilities = new Set<ChatCapability>(['interactions.callbacks', 'messages.buttons'])
    const noFileHelp = buildHelpText(noFileCapabilities, 'dm', { isBotAdmin: false, isGroupAdmin: false })
    expect(noFileHelp).not.toContain('/context')
  })

  test('/help on provider with file support does not contain deferral note', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const fileCapabilities = new Set<ChatCapability>(['interactions.callbacks', 'messages.buttons', 'messages.files'])
    const fileHelp = buildHelpText(fileCapabilities, 'dm', { isBotAdmin: true, isGroupAdmin: false })
    expect(fileHelp).not.toContain('deferred')
  })
})
