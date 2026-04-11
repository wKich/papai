import { describe, expect, it, test } from 'bun:test'

import type {
  ChatCapability,
  ChatProvider,
  ContextType,
  IncomingInteraction,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from '../../src/chat/types.js'

describe('ThreadCapabilities', () => {
  it('should have correct structure', () => {
    const caps: ThreadCapabilities = {
      supportsThreads: true,
      canCreateThreads: false,
      threadScope: 'message',
    }
    expect(caps.supportsThreads).toBe(true)
    expect(caps.canCreateThreads).toBe(false)
    expect(caps.threadScope).toBe('message')
  })
})

describe('ResolveUserContext', () => {
  test('has contextId and contextType', () => {
    const ctx: ResolveUserContext = { contextId: 'c1', contextType: 'group' }
    expect(ctx.contextId).toBe('c1')
    expect(ctx.contextType).toBe('group')
  })

  test('contextType accepts dm and group', () => {
    const dm: ContextType = 'dm'
    const group: ContextType = 'group'
    const ctxDm: ResolveUserContext = { contextId: 'u1', contextType: dm }
    const ctxGroup: ResolveUserContext = { contextId: 'g1', contextType: group }
    expect(ctxDm.contextType).toBe('dm')
    expect(ctxGroup.contextType).toBe('group')
  })
})

describe('ChatProvider interface', () => {
  test('resolveUserId accepts username and context', async () => {
    const mockProvider: ChatProvider = {
      name: 'mock',
      threadCapabilities: {
        supportsThreads: true,
        canCreateThreads: false,
        threadScope: 'message',
      },
      capabilities: new Set<ChatCapability>(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: (): void => {},
      onMessage: (): void => {},
      sendMessage: async (): Promise<void> => {},
      resolveUserId: (username: string, _context: ResolveUserContext): Promise<string | null> => {
        if (username === 'testuser') return Promise.resolve('user123')
        return Promise.resolve(null)
      },
      start: async (): Promise<void> => {},
      stop: async (): Promise<void> => {},
    }

    const context: ResolveUserContext = { contextId: 'c1', contextType: 'group' }
    const result = await mockProvider.resolveUserId?.('testuser', context)
    expect(result).toBe('user123')

    const notFound = await mockProvider.resolveUserId?.('nonexistent', context)
    expect(notFound).toBeNull()
  })

  test('ChatProvider interface includes capability metadata and optional interaction hooks', () => {
    const capabilities: ChatCapability[] = ['messages.buttons', 'interactions.callbacks']

    const mockProvider: ChatProvider = {
      name: 'mock',
      threadCapabilities: {
        supportsThreads: true,
        canCreateThreads: false,
        threadScope: 'message',
      },
      capabilities: new Set(capabilities),
      traits: { observedGroupMessages: 'all', callbackDataMaxLength: 64 },
      configRequirements: [{ key: 'BOT_TOKEN', label: 'Bot Token', required: true }],
      registerCommand: (): void => {},
      onMessage: (): void => {},
      onInteraction: (_handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      resolveUserId: (): Promise<string | null> => Promise.resolve('user123'),
      setCommands: (_adminUserId: string): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }

    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'user123', username: 'alice', isAdmin: false },
      contextId: 'ctx-1',
      contextType: 'dm',
      callbackData: 'cfg:setup',
    }

    expect(mockProvider.capabilities.has('messages.buttons')).toBe(true)
    expect(mockProvider.traits.callbackDataMaxLength).toBe(64)
    expect(interaction.callbackData).toBe('cfg:setup')
  })
})
