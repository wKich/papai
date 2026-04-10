import { beforeEach, describe, expect, test } from 'bun:test'

import type { GuildLike } from '../../../src/chat/discord/client-factory.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('client-factory', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('defaultClientFactory creates a discord.js Client instance with the required interface', async () => {
    const { defaultClientFactory } = await import('../../../src/chat/discord/client-factory.js')
    const client = defaultClientFactory()
    expect(typeof client.on).toBe('function')
    expect(typeof client.once).toBe('function')
    expect(typeof client.login).toBe('function')
    expect(typeof client.destroy).toBe('function')
    await client.destroy().catch(() => undefined)
  })

  test('GuildLike type accepts objects with a members.search method', () => {
    const guild: GuildLike = {
      members: {
        search: (_arg: { query: string; limit: number }): Promise<Map<string, { id: string }>> =>
          Promise.resolve(new Map<string, { id: string }>()),
      },
    }
    expect(typeof guild.members.search).toBe('function')
  })
})
