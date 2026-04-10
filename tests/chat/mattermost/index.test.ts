import { beforeEach, describe, expect, test } from 'bun:test'

import { fetchMattermostFiles } from '../../../src/chat/mattermost/file-helpers.js'
import { MattermostChatProvider } from '../../../src/chat/mattermost/index.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

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
