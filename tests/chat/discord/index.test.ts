import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { ButtonInteractionLike } from '../../../src/chat/discord/buttons.js'
import type { DiscordClientFactory } from '../../../src/chat/discord/index.js'
import type { ContextSnapshot, IncomingMessage } from '../../../src/chat/types.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { startGroupSettingsSelection } from '../../../src/group-settings/selector.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, mockMessageCache, setupTestDb } from '../../utils/test-helpers.js'

describe('DiscordChatProvider', () => {
  const originalToken = process.env['DISCORD_BOT_TOKEN']

  beforeEach(async () => {
    mockLogger()
    mockMessageCache()
    await setupTestDb()
    process.env['DISCORD_BOT_TOKEN'] = 'fake-token-123'
    process.env['ADMIN_USER_ID'] = 'admin-id'
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

  describe('renderContext', () => {
    test('returns embed method result with context snapshot', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

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

      const result = provider.renderContext(snapshot)

      expect(result.method).toBe('embed')
      if (result.method === 'embed') {
        expect(result.embed.title).toBe('Context · gpt-4o')
        expect(result.embed.description).toContain('🟦')
        expect(result.embed.footer).toContain('1,500')
        expect(result.embed.footer).toContain('128,000')
        expect(result.embed.color).toBe(0x2ecc71)
      }
    })
  })

  describe('defaultClientFactory', () => {
    test('creates a discord.js Client instance with the required interface', async () => {
      const { defaultClientFactory } = await import('../../../src/chat/discord/index.js')
      const client = defaultClientFactory()
      expect(typeof client.on).toBe('function')
      expect(typeof client.once).toBe('function')
      expect(typeof client.login).toBe('function')
      expect(typeof client.destroy).toBe('function')
      // Clean up the client to avoid open handles
      await client.destroy().catch(() => undefined)
    })
  })

  describe('start()', () => {
    test('resolves when ClientReady fires after login', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const readyListeners: Array<(arg: { user: { id: string; username: string } }) => void> = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: null,
        on: (_event: string, _listener: (...args: unknown[]) => void): void => undefined,
        once: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'ready') readyListeners.push(listener as (typeof readyListeners)[0])
        },
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider(factory)
      const startPromise = provider.start()

      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })

      await startPromise
    })

    test('registers messageCreate, interactionCreate, and error listeners', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const registeredEvents: string[] = []
      const readyListeners: Array<(arg: { user: { id: string; username: string } }) => void> = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: null,
        on: (event: string, _listener: (...args: unknown[]) => void): void => {
          registeredEvents.push(event)
        },
        once: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'ready') readyListeners.push(listener as (typeof readyListeners)[0])
        },
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider(factory)
      const startPromise = provider.start()

      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      expect(registeredEvents).toContain('messageCreate')
      expect(registeredEvents).toContain('interactionCreate')
      expect(registeredEvents).toContain('error')
    })

    test('dispatches incoming DM message via messageCreate listener', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const messageListeners: Array<(...args: unknown[]) => void> = []
      const readyListeners: Array<(arg: { user: { id: string; username: string } }) => void> = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: { id: 'bot-42', username: 'testbot' },
        on: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'messageCreate') messageListeners.push(listener)
        },
        once: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'ready') readyListeners.push(listener as (typeof readyListeners)[0])
        },
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider(factory)

      let resolveReceived!: (msg: IncomingMessage) => void
      const received = new Promise<IncomingMessage>((res) => {
        resolveReceived = res
      })
      provider.onMessage((msg): Promise<void> => {
        resolveReceived(msg)
        return Promise.resolve()
      })

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      const fakeMessage = {
        id: 'msg-dm-1',
        author: { id: 'u1', username: 'alice', bot: false },
        content: 'hello from dm',
        channel: {
          id: 'dm-chan-1',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'out1', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        mentions: { has: (_id: string): boolean => false },
        reference: null,
        type: 0,
      }

      messageListeners[0]!(fakeMessage)
      const msg = await received

      expect(msg.text).toBe('hello from dm')
      expect(msg.contextType).toBe('dm')
      expect(msg.user.id).toBe('u1')
    })

    test('error listener fires without throwing', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const errorListeners: Array<(...args: unknown[]) => void> = []
      const readyListeners: Array<(arg: { user: { id: string; username: string } }) => void> = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: null,
        on: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'error') errorListeners.push(listener)
        },
        once: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'ready') readyListeners.push(listener as (typeof readyListeners)[0])
        },
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider(factory)
      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      // Fire the error listener — should not throw
      expect(() => errorListeners[0]!(new Error('test discord error'))).not.toThrow()
      // Also exercise the non-Error path
      expect(() => errorListeners[0]!('string error')).not.toThrow()
    })

    test('non-button interactionCreate is silently ignored', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const interactionListeners: Array<(...args: unknown[]) => void> = []
      const readyListeners: Array<(arg: { user: { id: string; username: string } }) => void> = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: null,
        on: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'interactionCreate') interactionListeners.push(listener)
        },
        once: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'ready') readyListeners.push(listener as (typeof readyListeners)[0])
        },
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider(factory)

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      interactionListeners[0]!({ type: 2, componentType: 2 })
      await Promise.resolve()

      expect(seen).toHaveLength(0)
    })

    test('button interactionCreate dispatches to message handler via start()', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      // Authorize the user
      addUser('u5', 'admin-id', 'eve')

      const interactionListeners: Array<(...args: unknown[]) => void> = []
      const readyListeners: Array<(arg: { user: { id: string; username: string } }) => void> = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: { id: 'bot-42', username: 'testbot' },
        on: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'interactionCreate') interactionListeners.push(listener)
        },
        once: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'ready') readyListeners.push(listener as (typeof readyListeners)[0])
        },
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider(factory)

      let resolveReceived!: (msg: IncomingMessage) => void
      const received = new Promise<IncomingMessage>((res) => {
        resolveReceived = res
      })
      provider.onMessage((msg): Promise<void> => {
        resolveReceived(msg)
        return Promise.resolve()
      })

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      const fakeButtonInteraction = {
        type: 3,
        componentType: 2,
        user: { id: 'u5', username: 'eve' },
        customId: 'test:btn',
        channelId: 'u5',
        channel: {
          id: 'u5',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'm-btn', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-btn-1' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      interactionListeners[0]!(fakeButtonInteraction)
      const msg = await received

      expect(msg.text).toBe('test:btn')
      expect(msg.user.id).toBe('u5')
    })
  })

  describe('testDispatchButtonInteraction', () => {
    test('calls deferUpdate and routes customId to message handler', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

      // Authorize the user
      addUser('u1', 'admin-id', 'alice')

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      let deferred = false
      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u1', username: 'alice' },
        customId: 'test:action',
        channelId: 'u1',
        channel: {
          id: 'u1',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-x', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'original-msg-1' },
        deferUpdate: (): Promise<void> => {
          deferred = true
          return Promise.resolve()
        },
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42', 'admin-id')

      expect(deferred).toBe(true)
      expect(seen).toHaveLength(1)
      expect(seen[0]!.text).toBe('test:action')
    })

    test('routes slash-prefixed customId to registered command handler', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

      // Authorize the user
      addUser('u2', 'admin-id', 'bob')

      const captured: IncomingMessage[] = []
      provider.registerCommand('help', (msg): Promise<void> => {
        captured.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u2', username: 'bob' },
        customId: '/help',
        channelId: 'u2',
        channel: {
          id: 'u2',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-y', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'btn-msg-2' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42', 'admin-id')

      expect(captured).toHaveLength(1)
      expect(captured[0]!.text).toBe('/help')
    })

    test('uses user ID as contextId in DM channels (type=1)', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

      // Authorize the user
      addUser('user-77', 'admin-id', 'carol')

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'user-77', username: 'carol' },
        customId: 'some:action',
        channelId: 'dm-channel-77',
        channel: {
          id: 'dm-channel-77',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'm1', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-3' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42', 'admin-id')

      expect(seen[0]!.contextId).toBe('user-77')
      expect(seen[0]!.contextType).toBe('dm')
    })

    test('uses channelId as contextId in guild channels (type=0)', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

      // Authorize the user
      addUser('user-88', 'admin-id', 'dave')

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'user-88', username: 'dave' },
        customId: 'some:action',
        channelId: 'guild-channel-99',
        channel: {
          id: 'guild-channel-99',
          type: 0,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'm2', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-4' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42', 'admin-id')

      expect(seen[0]!.contextId).toBe('guild-channel-99')
      expect(seen[0]!.contextType).toBe('group')
    })

    test('skips dispatch when channel is null', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u3', username: 'eve' },
        customId: 'some:action',
        channelId: 'chan-x',
        channel: null,
        message: { id: 'msg-5' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42', 'admin-id')

      expect(seen).toHaveLength(0)
    })

    test('handles cfg: callback when no active editor (no-op)', async () => {
      await setupTestDb()
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

      let deferred = false
      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'user-cfg', username: 'cfguser' },
        customId: 'cfg:edit:llm_apikey',
        channelId: 'user-cfg',
        channel: {
          id: 'user-cfg',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-cfg', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-cfg-1' },
        deferUpdate: (): Promise<void> => {
          deferred = true
          return Promise.resolve()
        },
      }

      // No active editor, should defer and return without error
      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42', 'admin-id')
      expect(deferred).toBe(true)
    })

    test('handles wizard_ callback when no active wizard (no-op)', async () => {
      await setupTestDb()
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

      let deferred = false
      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'user-wiz', username: 'wizuser' },
        customId: 'wizard_confirm',
        channelId: 'user-wiz',
        channel: {
          id: 'user-wiz',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-wiz', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-wiz-1' },
        deferUpdate: (): Promise<void> => {
          deferred = true
          return Promise.resolve()
        },
      }

      // No active wizard, should defer and return without error
      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42', 'admin-id')
      expect(deferred).toBe(true)
    })

    test('Discord DM group-settings callback opens config for the selected group', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()
      await setupTestDb()

      upsertKnownGroupContext({
        contextId: 'group-1',
        provider: 'discord',
        displayName: 'Operations',
        parentName: 'Platform',
      })
      upsertGroupAdminObservation({
        contextId: 'group-1',
        userId: 'user-1',
        username: 'alice',
        isAdmin: true,
      })
      startGroupSettingsSelection('user-1', 'config', true)

      const sends: Array<{ content?: string }> = []
      const interaction: ButtonInteractionLike = {
        user: { id: 'user-1', username: 'alice' },
        customId: 'gsel:scope:group',
        channelId: 'dm-1',
        channel: {
          id: 'dm-1',
          type: 1,
          send: (arg: { content?: string }): Promise<{ id: string; edit: () => Promise<void> }> => {
            sends.push(arg)
            return Promise.resolve({ id: 'out-1', edit: (): Promise<void> => Promise.resolve() })
          },
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'm-1' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(interaction, 'bot-id', 'admin-id')

      expect(sends[0]?.content).toContain('Choose a group to configure.')
    })

    test('Discord DM selector continues into setup when the selector command is setup', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()
      await setupTestDb()

      upsertKnownGroupContext({
        contextId: 'group-1',
        provider: 'discord',
        displayName: 'Operations',
        parentName: 'Platform',
      })
      upsertGroupAdminObservation({
        contextId: 'group-1',
        userId: 'user-1',
        username: 'alice',
        isAdmin: true,
      })
      startGroupSettingsSelection('user-1', 'setup', true)

      const groupSelectorInteraction: ButtonInteractionLike = {
        user: { id: 'user-1', username: 'alice' },
        customId: 'gsel:scope:group',
        channelId: 'dm-1',
        channel: {
          id: 'dm-1',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'out-0', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'm-0' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }
      await provider.testDispatchButtonInteraction(groupSelectorInteraction, 'bot-id', 'admin-id')

      const sends: Array<{ content?: string }> = []
      const interaction: ButtonInteractionLike = {
        user: { id: 'user-1', username: 'alice' },
        customId: 'gsel:group:group-1',
        channelId: 'dm-1',
        channel: {
          id: 'dm-1',
          type: 1,
          send: (arg: { content?: string }): Promise<{ id: string; edit: () => Promise<void> }> => {
            sends.push(arg)
            return Promise.resolve({ id: 'out-1', edit: (): Promise<void> => Promise.resolve() })
          },
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'm-1' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(interaction, 'bot-id', 'admin-id')

      expect(sends[0]?.content).toContain('Welcome to papai configuration wizard!')
    })

    test('handles deferUpdate failure gracefully', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider()

      // Authorize the user
      addUser('u-def', 'admin-id', 'defer-fail')

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u-def', username: 'defer-fail' },
        customId: 'fallback:action',
        channelId: 'u-def',
        channel: {
          id: 'u-def',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-def', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-def-1' },
        deferUpdate: (): Promise<void> => Promise.reject(new Error('Defer failed')),
      }

      // Should still route to message handler despite defer failure
      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42', 'admin-id')
      expect(seen).toHaveLength(1)
      expect(seen[0]!.text).toBe('fallback:action')
    })
  })

  describe('listener rejection handling', () => {
    test('messageCreate listener catches and does not rethrow when dispatchMessage rejects', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const messageListeners: Array<(...args: unknown[]) => void> = []
      const readyListeners: Array<(arg: { user: { id: string; username: string } }) => void> = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: { id: 'bot-42', username: 'testbot' },
        on: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'messageCreate') messageListeners.push(listener)
        },
        once: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'ready') readyListeners.push(listener as (typeof readyListeners)[0])
        },
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider(factory)

      provider.onMessage((): Promise<void> => Promise.reject(new Error('handler boom')))

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      const fakeMessage = {
        id: 'msg-rej-1',
        author: { id: 'u1', username: 'alice', bot: false },
        content: 'hello',
        channel: {
          id: 'dm-rej-1',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'out-rej', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        mentions: { has: (_id: string): boolean => false },
        reference: null,
        type: 0,
      }

      // Fire the listener — the rejection must be caught inside the listener, not propagated
      messageListeners[0]!(fakeMessage)
      // Flush microtasks to let the promise rejection propagate if unhandled
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      // No assertion needed: reaching here without an unhandled rejection is the proof
    })

    test('interactionCreate listener catches and does not rethrow when handleButtonInteraction rejects', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const interactionListeners: Array<(...args: unknown[]) => void> = []
      const readyListeners: Array<(arg: { user: { id: string; username: string } }) => void> = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: { id: 'bot-42', username: 'testbot' },
        on: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'interactionCreate') interactionListeners.push(listener)
        },
        once: (event: string, listener: (...args: unknown[]) => void): void => {
          if (event === 'ready') readyListeners.push(listener as (typeof readyListeners)[0])
        },
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider(factory)

      // message handler throws so the full dispatch path rejects
      provider.onMessage((): Promise<void> => Promise.reject(new Error('interaction boom')))

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      const fakeInteraction = {
        type: 3,
        componentType: 2,
        user: { id: 'u-rej', username: 'rej-user' },
        customId: 'some:action',
        channelId: 'u-rej',
        channel: {
          id: 'u-rej',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'm-rej', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-rej-btn' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      interactionListeners[0]!(fakeInteraction)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    })
  })
})
