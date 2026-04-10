import { describe, expect, it, test } from 'bun:test'

import type { ChatProvider, ThreadCapabilities } from '../../src/chat/types.js'

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

describe('ChatProvider interface', () => {
  test('resolveUserId method exists', async () => {
    // Mock provider implementing the interface
    const mockProvider: ChatProvider = {
      name: 'mock',
      threadCapabilities: {
        supportsThreads: true,
        canCreateThreads: false,
        threadScope: 'message',
      },
      registerCommand: (): void => {},
      onMessage: (): void => {},
      sendMessage: async (): Promise<void> => {},
      resolveUserId: (username: string): Promise<string | null> => {
        if (username === 'testuser') return Promise.resolve('user123')
        return Promise.resolve(null)
      },
      start: async (): Promise<void> => {},
      stop: async (): Promise<void> => {},
    }

    const result = await mockProvider.resolveUserId('testuser')
    expect(result).toBe('user123')

    const notFound = await mockProvider.resolveUserId('nonexistent')
    expect(notFound).toBeNull()
  })
})
