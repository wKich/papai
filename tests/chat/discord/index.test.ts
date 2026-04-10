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
})
