import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { IncomingMessage } from '../../../src/chat/types.js'
import { mockLogger, mockMessageCache } from '../../utils/test-helpers.js'

describe('DiscordChatProvider', () => {
  const originalToken = process.env['DISCORD_BOT_TOKEN']

  beforeEach(() => {
    mockLogger()
    mockMessageCache()
    process.env['DISCORD_BOT_TOKEN'] = 'fake-token-123'
  })

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env['DISCORD_BOT_TOKEN']
    } else {
      process.env['DISCORD_BOT_TOKEN'] = originalToken
    }
  })

  test('constructor throws when DISCORD_BOT_TOKEN is missing', async () => {
    delete process.env['DISCORD_BOT_TOKEN']
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    expect(() => new DiscordChatProvider()).toThrow('DISCORD_BOT_TOKEN environment variable is required')
  })

  test('constructor throws when DISCORD_BOT_TOKEN is whitespace only', async () => {
    process.env['DISCORD_BOT_TOKEN'] = '   '
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    expect(() => new DiscordChatProvider()).toThrow('DISCORD_BOT_TOKEN environment variable is required')
  })

  test('constructor succeeds with a non-empty token and exposes name="discord"', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()
    expect(provider.name).toBe('discord')
  })

  test('registerCommand routes a matching /help text through the command handler', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()

    const captured: IncomingMessage[] = []
    provider.registerCommand('help', (msg): Promise<void> => {
      captured.push(msg)
      return Promise.resolve()
    })

    const fakeMessage = {
      id: 'm1',
      author: { id: 'u1', username: 'alice', bot: false },
      content: '<@bot_id> /help',
      channel: {
        id: 'c1',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'out1', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
      mentions: { has: (id: string): boolean => id === 'bot_id' },
      reference: null,
      type: 0,
    }
    await provider.testDispatchMessage(fakeMessage, 'bot_id', 'admin_id')

    expect(captured).toHaveLength(1)
    expect(captured[0]!.text).toBe('/help')
  })

  test('onMessage receives non-command messages after mapping', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()

    const seen: IncomingMessage[] = []
    provider.onMessage((msg): Promise<void> => {
      seen.push(msg)
      return Promise.resolve()
    })

    const fakeMessage = {
      id: 'm2',
      author: { id: 'u2', username: 'bob', bot: false },
      content: '<@bot_id> what is the weather',
      channel: {
        id: 'c2',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'out2', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
      mentions: { has: (id: string): boolean => id === 'bot_id' },
      reference: null,
      type: 0,
    }
    await provider.testDispatchMessage(fakeMessage, 'bot_id', 'admin_id')

    expect(seen).toHaveLength(1)
    expect(seen[0]!.text).toBe('what is the weather')
  })

  test('bot-authored messages are ignored', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()
    const seen: IncomingMessage[] = []
    provider.onMessage((msg): Promise<void> => {
      seen.push(msg)
      return Promise.resolve()
    })
    const fakeMessage = {
      id: 'm3',
      author: { id: 'bot_id', username: 'bot', bot: true },
      content: '<@bot_id> nothing',
      channel: {
        id: 'c3',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'out3', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
      mentions: { has: (): boolean => true },
      reference: null,
      type: 0,
    }
    await provider.testDispatchMessage(fakeMessage, 'bot_id', 'admin_id')
    expect(seen).toHaveLength(0)
  })

  test('stop() calls client.destroy when a client exists', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()
    let destroyed = false
    provider.testSetClient({
      destroy: (): Promise<void> => {
        destroyed = true
        return Promise.resolve()
      },
    })
    await provider.stop()
    expect(destroyed).toBe(true)
  })

  test('sendMessage creates a DM channel and sends the markdown', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()

    const sends: { content?: string }[] = []
    const dmChannel = {
      id: 'dm-chan-1',
      send: (arg: { content?: string }): Promise<{ id: string; edit: () => Promise<void> }> => {
        sends.push(arg)
        return Promise.resolve({ id: 'msg-x', edit: (): Promise<void> => Promise.resolve() })
      },
      sendTyping: (): Promise<void> => Promise.resolve(),
    }
    const fakeClient = {
      destroy: (): Promise<void> => Promise.resolve(),
      users: {
        fetch: (id: string): Promise<{ createDM: () => Promise<typeof dmChannel> }> => {
          expect(id).toBe('user-42')
          return Promise.resolve({
            createDM: (): Promise<typeof dmChannel> => Promise.resolve(dmChannel),
          })
        },
      },
    }
    provider.testSetClient(fakeClient)

    await provider.sendMessage('user-42', 'hello discord')
    expect(sends).toHaveLength(1)
    expect(sends[0]!.content).toBe('hello discord')
  })

  test('resolveUserId returns snowflake as-is when the input is numeric', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()
    const result = await provider.resolveUserId('1234567890', { contextId: 'c1', contextType: 'group' })
    expect(result).toBe('1234567890')
  })

  test('resolveUserId returns null in DMs (no guild context)', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()
    const result = await provider.resolveUserId('@alice', { contextId: 'u1', contextType: 'dm' })
    expect(result).toBeNull()
  })

  test('resolveUserId searches members in the channel guild for group context', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()

    const fakeGuild = {
      members: {
        search: (arg: { query: string; limit: number }): Promise<Map<string, { id: string }>> => {
          expect(arg.query).toBe('alice')
          expect(arg.limit).toBe(1)
          return Promise.resolve(new Map([['u-9', { id: 'u-9' }]]))
        },
      },
    }
    const fakeClient = {
      destroy: (): Promise<void> => Promise.resolve(),
      channels: {
        cache: new Map([['chan-7', { guildId: 'guild-3' }]]),
      },
      guilds: {
        cache: new Map([['guild-3', fakeGuild]]),
      },
    }
    provider.testSetClient(fakeClient)

    const result = await provider.resolveUserId('@alice', { contextId: 'chan-7', contextType: 'group' })
    expect(result).toBe('u-9')
  })
})
