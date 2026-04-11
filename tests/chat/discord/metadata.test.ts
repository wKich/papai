import { describe, expect, test } from 'bun:test'

import { discordCapabilities, discordConfigRequirements, discordTraits } from '../../../src/chat/discord/metadata.js'

describe('discord metadata', () => {
  test('capabilities include the core Discord features', () => {
    expect(discordCapabilities.has('messages.buttons')).toBe(true)
    expect(discordCapabilities.has('interactions.callbacks')).toBe(true)
    expect(discordCapabilities.has('users.resolve')).toBe(true)
    expect(discordCapabilities.has('messages.files')).toBe(true)
  })

  test('capabilities exclude commands.menu (Discord has no bot command menu)', () => {
    expect(discordCapabilities.has('commands.menu')).toBe(false)
  })

  test('traits use mentions_only observed group messages and 2000 char cap', () => {
    expect(discordTraits.observedGroupMessages).toBe('mentions_only')
    expect(discordTraits.maxMessageLength).toBe(2000)
  })

  test('config requirements include DISCORD_BOT_TOKEN', () => {
    const token = discordConfigRequirements.find((r) => r.key === 'DISCORD_BOT_TOKEN')
    expect(token).toBeDefined()
    expect(token?.required).toBe(true)
  })
})
