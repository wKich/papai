import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  IncomingMessage,
  ReplyFn,
} from '../../src/chat/types.js'

// Mock logger to avoid output during tests
void mock.module('../../src/logger.js', () => ({
  logger: {
    child: (): { debug: () => void; info: () => void; warn: () => void; error: () => void } => ({
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
    }),
  },
}))

import { registerHelpCommand } from '../../src/commands/help.js'

describe('help command', () => {
  let capturedText: string | null = null
  let lastHandler: CommandHandler | null = null

  const mockReply: ReplyFn = {
    text: (content: string): Promise<void> => {
      capturedText = content
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
  }

  const createMockChat = (): ChatProvider => ({
    name: 'mock',
    registerCommand: (_name: string, handler: CommandHandler): void => {
      lastHandler = handler
    },
    onMessage: (): void => {},
    sendMessage: (): Promise<void> => Promise.resolve(),
    start: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  })

  beforeEach(() => {
    capturedText = null
    lastHandler = null
  })

  test('DM help shows user management commands for admin', async () => {
    const chat = createMockChat()
    registerHelpCommand(chat)

    const dmMsg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'user1',
      contextType: 'dm',
      isMentioned: false,
      text: '/help',
    }

    const auth: AuthorizationResult = {
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
    const chat = createMockChat()
    registerHelpCommand(chat)

    const dmMsg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'user1',
      contextType: 'dm',
      isMentioned: false,
      text: '/help',
    }

    const auth: AuthorizationResult = {
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
    const chat = createMockChat()
    registerHelpCommand(chat)

    const groupMsg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'group1',
      contextType: 'group',
      isMentioned: false,
      text: '/help',
    }

    const auth: AuthorizationResult = {
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
    const chat = createMockChat()
    registerHelpCommand(chat)

    const groupMsg: IncomingMessage = {
      user: { id: 'admin1', username: 'adminuser', isAdmin: true },
      contextId: 'group1',
      contextType: 'group',
      isMentioned: false,
      text: '/help',
    }

    const auth: AuthorizationResult = {
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
