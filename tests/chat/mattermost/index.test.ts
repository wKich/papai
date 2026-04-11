import { beforeEach, describe, expect, test } from 'bun:test'

import { fetchMattermostFiles } from '../../../src/chat/mattermost/file-helpers.js'
import { MattermostChatProvider } from '../../../src/chat/mattermost/index.js'
import { mattermostCapabilities } from '../../../src/chat/mattermost/metadata.js'
import type { IncomingMessage } from '../../../src/chat/types.js'
import { createMockReply, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

type BuiltPostedMessage = { readonly msg: IncomingMessage }

function isIncomingMessage(value: unknown): value is IncomingMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'contextId' in value &&
    'contextType' in value &&
    'isMentioned' in value &&
    'text' in value
  )
}

function isBuiltPostedMessage(value: unknown): value is BuiltPostedMessage {
  return typeof value === 'object' && value !== null && 'msg' in value && isIncomingMessage(value.msg)
}

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

  test('buildPostedMessage includes channel and team names', async () => {
    const { reply } = createMockReply()

    provider = new MattermostChatProvider()

    Reflect.set(provider, 'apiFetch', (_method: string, path: string, _body: unknown) => {
      if (path === '/api/v4/channels/chan-1') {
        return Promise.resolve({
          type: 'O',
          display_name: 'Operations',
          name: 'operations',
          team_id: 'team-1',
        })
      }
      if (path === '/api/v4/teams/team-1') {
        return Promise.resolve({
          display_name: 'Platform',
          name: 'platform',
        })
      }
      return Promise.resolve({})
    })
    Reflect.set(provider, 'checkChannelAdmin', () => Promise.resolve(true))
    Reflect.set(provider, 'buildReplyFn', () => reply)

    const buildPostedMessage: unknown = Reflect.get(provider, 'buildPostedMessage')
    expect(buildPostedMessage).toBeInstanceOf(Function)
    if (!(buildPostedMessage instanceof Function)) {
      throw new TypeError('buildPostedMessage not available')
    }

    const result: unknown = await Promise.resolve(
      buildPostedMessage.call(
        provider,
        {
          id: 'post-1',
          user_id: 'user-1',
          channel_id: 'chan-1',
          message: '@papai hi',
          user_name: 'alice',
          file_ids: [],
        },
        'alice',
        undefined,
      ),
    )

    if (!isBuiltPostedMessage(result)) {
      throw new TypeError('Expected buildPostedMessage to return a message wrapper')
    }

    expect(result.msg.contextName).toBe('Operations')
    expect(result.msg.contextParentName).toBe('Platform')
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
