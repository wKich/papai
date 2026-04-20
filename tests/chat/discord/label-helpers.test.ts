import { expect, test } from 'bun:test'

import { formatDiscordUserLabel, getDiscordUserDisplayName } from '../../../src/chat/discord/label-helpers.js'

test('formatDiscordUserLabel formats display name with username when they differ', () => {
  expect(formatDiscordUserLabel('John Johnson', 'itsmike')).toBe('John Johnson (@itsmike)')
})

test('formatDiscordUserLabel returns display name when no username', () => {
  expect(formatDiscordUserLabel('John Johnson', null)).toBe('John Johnson')
})

test('formatDiscordUserLabel returns @username when no display name', () => {
  expect(formatDiscordUserLabel(null, 'itsmike')).toBe('@itsmike')
})

test('formatDiscordUserLabel returns null when both are null', () => {
  expect(formatDiscordUserLabel(null, null)).toBeNull()
})

test('formatDiscordUserLabel returns just display name when it equals username', () => {
  expect(formatDiscordUserLabel('itsmike', 'itsmike')).toBe('itsmike')
})

test('getDiscordUserDisplayName returns displayName when set', () => {
  expect(getDiscordUserDisplayName({ displayName: 'John', globalName: null, username: 'john' })).toBe('John')
})

test('getDiscordUserDisplayName falls back to globalName', () => {
  expect(getDiscordUserDisplayName({ displayName: '', globalName: 'John Global', username: 'john' })).toBe(
    'John Global',
  )
})

test('getDiscordUserDisplayName returns null when both are empty', () => {
  expect(getDiscordUserDisplayName({ displayName: '', globalName: null, username: 'john' })).toBeNull()
})
