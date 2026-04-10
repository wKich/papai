import { describe, expect, test } from 'bun:test'

import { isBotMentioned, stripBotMention } from '../../../src/chat/discord/mention-helpers.js'

describe('stripBotMention', () => {
  const botId = '1234567890123456'

  test('strips leading <@botId> mention and trim', () => {
    expect(stripBotMention(`<@${botId}> hello world`, botId)).toBe('hello world')
  })

  test('strips leading nickname-style <@!botId> mention', () => {
    expect(stripBotMention(`<@!${botId}> /help`, botId)).toBe('/help')
  })

  test('leaves other user mentions intact', () => {
    expect(stripBotMention(`<@${botId}> hello <@999>`, botId)).toBe('hello <@999>')
  })

  test('does not strip mid-string bot mentions', () => {
    expect(stripBotMention(`thanks <@${botId}> for help`, botId)).toBe(`thanks <@${botId}> for help`)
  })

  test('returns text unchanged when no bot mention present', () => {
    expect(stripBotMention('plain text', botId)).toBe('plain text')
  })

  test('handles empty string', () => {
    expect(stripBotMention('', botId)).toBe('')
  })

  test('handles mention followed by multiple whitespace', () => {
    expect(stripBotMention(`<@${botId}>    \t  hello`, botId)).toBe('hello')
  })
})

describe('isBotMentioned', () => {
  const botId = '1234567890123456'

  test('returns true in DMs unconditionally', () => {
    expect(isBotMentioned('hello there', botId, 'dm')).toBe(true)
    expect(isBotMentioned('', botId, 'dm')).toBe(true)
  })

  test('returns true when <@botId> appears in group channel content', () => {
    expect(isBotMentioned(`<@${botId}> do a thing`, botId, 'group')).toBe(true)
  })

  test('returns true when <@!botId> (nickname) appears in group content', () => {
    expect(isBotMentioned(`<@!${botId}> hey`, botId, 'group')).toBe(true)
  })

  test('returns false in group content that does not mention the bot', () => {
    expect(isBotMentioned('hello world', botId, 'group')).toBe(false)
    expect(isBotMentioned('<@9999> hey', botId, 'group')).toBe(false)
  })
})
