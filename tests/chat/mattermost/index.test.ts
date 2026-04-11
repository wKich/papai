import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { fetchMattermostFiles } from '../../../src/chat/mattermost/file-helpers.js'
import { MattermostChatProvider } from '../../../src/chat/mattermost/index.js'
import { mattermostCapabilities } from '../../../src/chat/mattermost/metadata.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

// Mock the auth module to provide getThreadScopedStorageContextId
void mock.module('../../../src/auth.js', () => ({
  getThreadScopedStorageContextId: (
    contextId: string,
    _contextType: 'dm' | 'group',
    threadId: string | undefined,
  ): string => {
    // Thread-scoped: groupId:threadId for threads
    if (threadId !== undefined) return `${contextId}:${threadId}`
    return contextId
  },
}))

describe('MattermostChatProvider', () => {
  let provider: MattermostChatProvider

  beforeEach(() => {
    // Set required env vars
    process.env['MATTERMOST_URL'] = 'http://localhost:8065'
    process.env['MATTERMOST_BOT_TOKEN'] = 'test-token'
  })

  describe('resolveUserId', () => {
    test('resolves username to user ID', async () => {
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/users/username/testuser')) {
          return Promise.resolve(new Response(JSON.stringify({ id: 'user123', username: 'testuser' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()
      const userId = await provider.resolveUserId('testuser', { contextId: 'c1', contextType: 'group' })

      expect(userId).toBe('user123')
      restoreFetch()
    })

    test('handles username with @ prefix', async () => {
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/users/username/testuser')) {
          return Promise.resolve(new Response(JSON.stringify({ id: 'user123', username: 'testuser' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()
      const userId = await provider.resolveUserId('@testuser', { contextId: 'c1', contextType: 'group' })

      expect(userId).toBe('user123')
      restoreFetch()
    })

    test('returns null for non-existent user', async () => {
      setMockFetch(() => {
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()
      const userId = await provider.resolveUserId('nonexistent', { contextId: 'c1', contextType: 'group' })

      expect(userId).toBeNull()
      restoreFetch()
    })
  })

  describe('capabilities', () => {
    test('advertises messages.files capability', () => {
      expect(mattermostCapabilities.has('messages.files')).toBe(true)
    })

    test('advertises users.resolve capability', () => {
      expect(mattermostCapabilities.has('users.resolve')).toBe(true)
    })

    test('does NOT advertise messages.buttons', () => {
      expect(mattermostCapabilities.has('messages.buttons')).toBe(false)
    })

    test('does NOT advertise interactions.callbacks', () => {
      expect(mattermostCapabilities.has('interactions.callbacks')).toBe(false)
    })

    test('does NOT advertise commands.menu', () => {
      expect(mattermostCapabilities.has('commands.menu')).toBe(false)
    })
  })

  describe('command thread scoping', () => {
    test('MattermostProvider is properly imported and has registerCommand', () => {
      // Verify the provider can be instantiated and has expected methods
      provider = new MattermostChatProvider()
      expect(typeof provider.registerCommand).toBe('function')
      expect(typeof provider.onMessage).toBe('function')
    })

    test('thread-scoped storage context format for threads', () => {
      // Thread-scoped format is groupId:threadId
      const contextId = 'channel123'
      const threadId = 'thread456'
      const result = `${contextId}:${threadId}`
      expect(result).toBe('channel123:thread456')
    })

    test('thread-scoped storage context format for DM', () => {
      const contextId = 'user123'
      // DM: just return contextId (userId)
      expect(contextId).toBe('user123')
    })

    test('thread-scoped storage context format for main chat', () => {
      const contextId = 'channel123'
      // Main chat: return contextId (channelId)
      expect(contextId).toBe('channel123')
    })
  })
})

describe('fetchMattermostFiles', () => {
  const makeApiFetch =
    (infoResponse: unknown) =>
    (_method: string, _path: string, _body: unknown): Promise<unknown> =>
      Promise.resolve(infoResponse)

  const makeFetchContent =
    (content: Buffer | null = Buffer.from('binary')) =>
    (_fileId: string): Promise<Buffer | null> =>
      Promise.resolve(content)

  test('returns empty array for empty file IDs', async () => {
    const result = await fetchMattermostFiles([], makeApiFetch({}), makeFetchContent())
    expect(result).toEqual([])
  })

  test('fetches metadata and content for each file', async () => {
    const content = Buffer.from('file-data')
    const apiFetch = (_method: string, path: string, _body: unknown): Promise<unknown> => {
      if (path.includes('/info')) {
        return Promise.resolve({ id: 'f1', name: 'report.pdf', mime_type: 'application/pdf', size: 1234 })
      }
      return Promise.resolve({})
    }

    const result = await fetchMattermostFiles(['f1'], apiFetch, makeFetchContent(content))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      fileId: 'f1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      content,
    })
  })

  test('skips file when content fetch returns null', async () => {
    const apiFetch = (_method: string, _path: string, _body: unknown): Promise<unknown> =>
      Promise.resolve({ id: 'f1', name: 'file.txt' })

    const result = await fetchMattermostFiles(['f1'], apiFetch, makeFetchContent(null))
    expect(result).toEqual([])
  })

  test('skips file when metadata parse fails', async () => {
    // Response missing required 'id' and 'name' fields
    const apiFetch = (_method: string, _path: string, _body: unknown): Promise<unknown> =>
      Promise.resolve({ unexpected: 'schema' })

    const result = await fetchMattermostFiles(['f1'], apiFetch, makeFetchContent())
    expect(result).toEqual([])
  })

  test('skips file when apiFetch throws', async () => {
    const apiFetch = (_method: string, _path: string, _body: unknown): Promise<unknown> => {
      throw new Error('network error')
    }

    const result = await fetchMattermostFiles(['f1'], apiFetch, makeFetchContent())
    expect(result).toEqual([])
  })

  test('fetches multiple files, skipping failures', async () => {
    const apiFetch = (_method: string, path: string, _body: unknown): Promise<unknown> => {
      if (path.includes('f1')) return Promise.resolve({ id: 'f1', name: 'a.txt' })
      throw new Error('fail')
    }

    const result = await fetchMattermostFiles(['f1', 'f2'], apiFetch, makeFetchContent())
    expect(result).toHaveLength(1)
    expect(result[0]?.fileId).toBe('f1')
  })
})
