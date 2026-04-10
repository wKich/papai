import { beforeEach, describe, expect, test } from 'bun:test'

import { createChatProvider } from '../../src/chat/registry.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('chat registry', () => {
  beforeEach(() => {
    mockLogger()
    process.env['DISCORD_BOT_TOKEN'] = 'fake-token-123'
  })

  test('createChatProvider("discord") returns a DiscordChatProvider instance', () => {
    const provider = createChatProvider('discord')
    expect(provider.name).toBe('discord')
  })

  test('createChatProvider("unknown") throws', () => {
    expect(() => createChatProvider('unknown')).toThrow(/Unknown chat provider/)
  })
})
