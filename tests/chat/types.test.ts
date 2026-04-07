import { describe, expect, test } from 'bun:test'

import type { ChatProvider } from '../../src/chat/types.js'

describe('ChatProvider interface', () => {
  test('resolveUserId method exists', async () => {
    // Mock provider implementing the interface
    const mockProvider: ChatProvider = {
      name: 'mock',
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
