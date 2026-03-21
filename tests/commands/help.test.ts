import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { createDmMessage, createGroupMessage, mockLogger } from '../utils/test-helpers.js'

// Setup logger mock before importing modules
mockLogger()

import { registerHelpCommand } from '../../src/commands/help.js'

describe('help command', () => {
  let capturedText: string | null = null
  let lastHandler: CommandHandler | null = null

  const mockChat: ChatProvider = {
    name: 'mock',
    registerCommand: (_name: string, handler: CommandHandler): void => {
      lastHandler = handler
    },
    onMessage: (): void => {},
    sendMessage: (): Promise<void> => Promise.resolve(),
    start: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }

  const mockReply = {
    text: (content: string): Promise<void> => {
      capturedText = content
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
  }

  beforeEach(() => {
    capturedText = null
    lastHandler = null
  })

  test('DM help shows user management commands for admin', async () => {
    registerHelpCommand(mockChat)

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
    expect(capturedText).toContain('/set')
    expect(capturedText).toContain('/config')
    expect(capturedText).toContain('/clear')
    expect(capturedText).toContain('/context')
  })

  test('DM help shows basic commands for non-admin', async () => {
    registerHelpCommand(mockChat)

    const dmMsg = createDmMessage('user1', '/help')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }

    await lastHandler!(dmMsg, mockReply, auth)

    expect(capturedText).toContain('/help')
    expect(capturedText).toContain('/set')
    expect(capturedText).toContain('/config')
    expect(capturedText).toContain('/clear')
    expect(capturedText).not.toContain('/user add')
    expect(capturedText).not.toContain('Admin commands:')
  })

  test('Group help shows group commands', async () => {
    registerHelpCommand(mockChat)

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
    expect(capturedText).not.toContain('/set')
    expect(capturedText).not.toContain('Admin commands:')
  })

  test('Group admin help includes config commands', async () => {
    registerHelpCommand(mockChat)

    const groupMsg = createGroupMessage('admin1', '/help', true, 'group1')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: true,
      storageContextId: 'group1',
    }

    await lastHandler!(groupMsg, mockReply, auth)

    expect(capturedText).toContain('/set')
    expect(capturedText).toContain('/config')
    expect(capturedText).toContain('/clear')
    expect(capturedText).toContain('Admin commands:')
  })
})
