import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger } from '../../utils/test-helpers.js'

describe('DiscordChatProvider', () => {
  const originalToken = process.env['DISCORD_BOT_TOKEN']

  beforeEach(() => {
    mockLogger()
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
    process.env['DISCORD_BOT_TOKEN'] = 'fake-token-123'
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider()
    expect(provider.name).toBe('discord')
  })
})
