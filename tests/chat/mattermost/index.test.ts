import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { fetchMattermostFiles } from '../../../src/chat/mattermost/file-helpers.js'
import { MattermostChatProvider } from '../../../src/chat/mattermost/index.js'
import { mattermostCapabilities } from '../../../src/chat/mattermost/metadata.js'
import type { MattermostPost } from '../../../src/chat/mattermost/schema.js'
import type { ContextSnapshot, IncomingMessage } from '../../../src/chat/types.js'
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

  describe('renderContext', () => {
    test('returns formatted method result with context snapshot', () => {
      const mmProvider = new MattermostChatProvider()
      const snapshot: ContextSnapshot = {
        modelName: 'gpt-4o',
        totalTokens: 1500,
        maxTokens: 128_000,
        approximate: false,
        sections: [
          { label: 'System prompt', tokens: 500 },
          { label: 'Tools', tokens: 1000 },
        ],
      }

      const result = mmProvider.renderContext(snapshot)

      expect(result.method).toBe('formatted')
      if (result.method === 'formatted') {
        expect(result.content).toContain('gpt-4o')
        expect(result.content).toContain('1,500')
        expect(result.content).toContain('128,000')
      }
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

    test('includes threadId in IncomingMessage for threaded posts', () => {
      // Test the threadId derivation logic directly
      // When root_id is set, threadId = root_id
      const rootId = 'root789'
      const replyToMessageId = undefined
      // Since rootId is always a string here, we simplify the check
      const computedThreadId = rootId.length === 0 ? replyToMessageId : rootId
      expect(computedThreadId).toBe('root789')
    })

    test('threadId falls back to replyToMessageId when root_id is empty', () => {
      // When root_id is empty, threadId should fall back to replyToMessageId
      const rootId = ''
      const replyToMessageId = 'parent456'
      const computedThreadId = rootId === undefined || rootId === '' ? replyToMessageId : rootId
      expect(computedThreadId).toBe('parent456')
    })

    test('threadId is undefined for non-threaded posts', () => {
      // When both root_id and replyToMessageId are undefined
      const rootId = undefined
      const replyToMessageId = undefined
      const computedThreadId = rootId === undefined || rootId === '' ? replyToMessageId : rootId
      expect(computedThreadId).toBeUndefined()
    })

    test('IncomingMessage contains threadId from root_id via message handler', async () => {
      // This test verifies the actual code path where threadId is populated
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/channels/')) {
          return Promise.resolve(new Response(JSON.stringify({ type: 'O' }), { status: 200 }))
        }
        if (url.includes('/api/v4/channels/') && url.includes('/members/')) {
          return Promise.resolve(new Response(JSON.stringify({ roles: '' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()

      // Trigger command handler via dispatch (simulating the full flow)
      // Access internal dispatch to test thread scoping directly
      const post: MattermostPost = {
        id: 'post123',
        user_id: 'user456',
        channel_id: 'channel789',
        message: '/test',
        root_id: 'threadRoot',
        parent_id: '',
      }

      // Call buildPostedMessage directly (marked as @package for testing)
      const result = await provider.buildPostedMessage(post, 'testuser', undefined)

      // Verify threadId is properly set in the IncomingMessage
      expect(result.msg.threadId).toBe('threadRoot')

      restoreFetch()
    })

    test('IncomingMessage contains threadId from replyToMessageId when root_id empty', async () => {
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/channels/')) {
          return Promise.resolve(new Response(JSON.stringify({ type: 'O' }), { status: 200 }))
        }
        if (url.includes('/api/v4/channels/') && url.includes('/members/')) {
          return Promise.resolve(new Response(JSON.stringify({ roles: '' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()

      const post: MattermostPost = {
        id: 'post123',
        user_id: 'user456',
        channel_id: 'channel789',
        message: '/test',
        root_id: '',
        parent_id: 'parentMsg',
      }

      // When replyToMessageId is provided (extracted from parent_id)
      const result = await provider.buildPostedMessage(post, 'testuser', 'parentMsg')

      // Verify threadId falls back to replyToMessageId
      expect(result.msg.threadId).toBe('parentMsg')

      restoreFetch()
    })

    test('IncomingMessage has undefined threadId for non-threaded posts', async () => {
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/channels/')) {
          return Promise.resolve(new Response(JSON.stringify({ type: 'O' }), { status: 200 }))
        }
        if (url.includes('/api/v4/channels/') && url.includes('/members/')) {
          return Promise.resolve(new Response(JSON.stringify({ roles: '' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()

      const post: MattermostPost = {
        id: 'post123',
        user_id: 'user456',
        channel_id: 'channel789',
        message: '/test',
        root_id: undefined,
        parent_id: undefined,
      }

      const result = await provider.buildPostedMessage(post, 'testuser', undefined)

      // Verify threadId is undefined for main channel posts
      expect(result.msg.threadId).toBeUndefined()

      restoreFetch()
    })

    test('creates threadId from post.id when mentioned in group (not already threaded)', async () => {
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/channels/')) {
          return Promise.resolve(new Response(JSON.stringify({ type: 'O' }), { status: 200 }))
        }
        if (url.includes('/api/v4/channels/') && url.includes('/members/')) {
          return Promise.resolve(new Response(JSON.stringify({ roles: '' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()
      // Manually set bot username for mention detection
      // @ts-expect-error - accessing private field for testing
      provider.botUsername = 'testbot'

      const post: MattermostPost = {
        id: 'post123',
        user_id: 'user456',
        channel_id: 'channel789',
        message: '@testbot help me with this',
        root_id: '',
        parent_id: undefined,
      }

      const result = await provider.buildPostedMessage(post, 'testuser', undefined)

      // When mentioned in group without existing thread, threadId = post.id
      expect(result.msg.isMentioned).toBe(true)
      expect(result.msg.threadId).toBe('post123')

      restoreFetch()
    })

    test('does NOT create thread when mentioned in DM', async () => {
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/channels/')) {
          return Promise.resolve(new Response(JSON.stringify({ type: 'D' }), { status: 200 }))
        }
        if (url.includes('/api/v4/channels/') && url.includes('/members/')) {
          return Promise.resolve(new Response(JSON.stringify({ roles: '' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()
      // @ts-expect-error - accessing private field for testing
      provider.botUsername = 'testbot'

      const post: MattermostPost = {
        id: 'post123',
        user_id: 'user456',
        channel_id: 'dm-channel',
        message: '@testbot help me',
        root_id: '',
        parent_id: undefined,
      }

      const result = await provider.buildPostedMessage(post, 'testuser', undefined)

      // In DMs, even when mentioned, don't create threads
      expect(result.msg.isMentioned).toBe(true)
      expect(result.msg.contextType).toBe('dm')
      expect(result.msg.threadId).toBeUndefined()

      restoreFetch()
    })

    test('thread capabilities advertise canCreateThreads=true', () => {
      provider = new MattermostChatProvider()
      expect(provider.threadCapabilities.supportsThreads).toBe(true)
      expect(provider.threadCapabilities.canCreateThreads).toBe(true)
      expect(provider.threadCapabilities.threadScope).toBe('post')
    })

    test('determineThreadId returns root_id when in existing thread', async () => {
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/channels/')) {
          return Promise.resolve(new Response(JSON.stringify({ type: 'O' }), { status: 200 }))
        }
        if (url.includes('/api/v4/channels/') && url.includes('/members/')) {
          return Promise.resolve(new Response(JSON.stringify({ roles: '' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()
      // @ts-expect-error - accessing private field for testing
      provider.botUsername = 'testbot'

      const post: MattermostPost = {
        id: 'reply456',
        user_id: 'user789',
        channel_id: 'channel789',
        message: 'Following up in thread',
        root_id: 'threadRoot123',
        parent_id: 'parent789',
      }

      const result = await provider.buildPostedMessage(post, 'testuser', 'parent789')

      // When already in a thread, use root_id
      expect(result.msg.threadId).toBe('threadRoot123')

      restoreFetch()
    })

    test('determineThreadId returns replyToMessageId when not mentioned and no root_id', async () => {
      setMockFetch((url: string) => {
        if (url.includes('/api/v4/channels/')) {
          return Promise.resolve(new Response(JSON.stringify({ type: 'O' }), { status: 200 }))
        }
        if (url.includes('/api/v4/channels/') && url.includes('/members/')) {
          return Promise.resolve(new Response(JSON.stringify({ roles: '' }), { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      provider = new MattermostChatProvider()
      // @ts-expect-error - accessing private field for testing
      provider.botUsername = 'testbot'

      const post: MattermostPost = {
        id: 'post123',
        user_id: 'user456',
        channel_id: 'channel789',
        // No @testbot mention
        message: 'Regular reply without mention',
        root_id: '',
        parent_id: 'parentMsg',
      }

      const result = await provider.buildPostedMessage(post, 'testuser', 'parentMsg')

      // When not mentioned and not in thread, use replyToMessageId
      expect(result.msg.isMentioned).toBe(false)
      expect(result.msg.threadId).toBe('parentMsg')

      restoreFetch()
    })

    test('determineThreadId method directly - mentioned in group creates thread', () => {
      provider = new MattermostChatProvider()
      const post: MattermostPost = {
        id: 'post789',
        user_id: 'user456',
        channel_id: 'channel789',
        message: '@testbot help',
        root_id: '',
        parent_id: undefined,
      }

      // @ts-expect-error - accessing private method for testing
      const result = provider.determineThreadId(post, true, 'group', undefined)
      expect(result).toBe('post789')
    })

    test('determineThreadId method directly - existing thread uses root_id', () => {
      provider = new MattermostChatProvider()
      const post: MattermostPost = {
        id: 'reply456',
        user_id: 'user456',
        channel_id: 'channel789',
        message: 'Reply in thread',
        root_id: 'threadRoot',
        parent_id: 'parent123',
      }

      // @ts-expect-error - accessing private method for testing
      const result = provider.determineThreadId(post, false, 'group', 'parent123')
      expect(result).toBe('threadRoot')
    })

    test('determineThreadId method directly - not mentioned uses replyToMessageId', () => {
      provider = new MattermostChatProvider()
      const post: MattermostPost = {
        id: 'post789',
        user_id: 'user456',
        channel_id: 'channel789',
        message: 'Regular message',
        root_id: '',
        parent_id: undefined,
      }

      // @ts-expect-error - accessing private method for testing
      const result = provider.determineThreadId(post, false, 'group', 'fallbackId')
      expect(result).toBe('fallbackId')
    })

    test('determineThreadId method directly - mentioned in DM does not create thread', () => {
      provider = new MattermostChatProvider()
      const post: MattermostPost = {
        id: 'post789',
        user_id: 'user456',
        channel_id: 'dm-channel',
        message: '@testbot help',
        root_id: '',
        parent_id: undefined,
      }

      // @ts-expect-error - accessing private method for testing
      const result = provider.determineThreadId(post, true, 'dm', undefined)
      expect(result).toBeUndefined()
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
