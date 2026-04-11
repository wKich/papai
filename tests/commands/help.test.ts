import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
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

  test('DM help explains that /setup and /config can target personal or group settings', async () => {
    const dmMsg = createDmMessage('user1', '/help')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }

    await lastHandler!(dmMsg, mockReply, auth)

    expect(capturedText).toContain('/help')
    expect(capturedText).toContain('/setup — Interactive configuration wizard for personal or group settings')
    expect(capturedText).toContain('/config — View or edit personal settings, or choose a group to configure from DM')
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

  test('Group admin help no longer advertises in-group /setup or /config', async () => {
    const groupMsg = createGroupMessage('admin1', '/help', true, 'group1')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: true,
      storageContextId: 'group1',
    }

    await lastHandler!(groupMsg, mockReply, auth)

    expect(capturedText).toContain('Group settings are configured in DM with the bot')
    expect(capturedText).not.toContain('/setup — Interactive configuration wizard')
    expect(capturedText).not.toContain('/config — View group configuration')
    expect(capturedText).toContain('/clear')
    expect(capturedText).toContain('Admin commands:')
  })
})

describe('buildHelpText', () => {
  test('/help on Discord admin appends a /context deferral note', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const discordHelp = buildHelpText('discord', 'dm', { isBotAdmin: true, isGroupAdmin: false })

    expect(discordHelp).toContain('/context')
    expect(discordHelp).toContain('deferred')
  })

  test('/help on Discord for non-admin does NOT mention /context', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const discordHelp = buildHelpText('discord', 'dm', { isBotAdmin: false, isGroupAdmin: false })
    expect(discordHelp).not.toContain('/context')
  })

  test('/help on telegram does not contain deferral note', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const telegramHelp = buildHelpText('telegram', 'dm', { isBotAdmin: true, isGroupAdmin: false })
    expect(telegramHelp).not.toContain('deferred')
  })
})
