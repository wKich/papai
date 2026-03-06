import { describe, expect, test, beforeAll } from 'bun:test'

import { formatLlmOutput } from '../src/utils/format.js'

// Set required env vars before importing bot
beforeAll(() => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  process.env['TELEGRAM_USER_ID'] = '12345'
})

describe('bot', () => {
  test('module loads with env vars', async () => {
    // Import bot after setting env vars
    const { bot } = await import('../src/bot.js')
    expect(bot).toBeDefined()
  })
})

describe('bot message formatting', () => {
  test('formatLlmOutput converts markdown to entities', () => {
    const result = formatLlmOutput('**bold** text')
    expect(result.text).toBe('bold text')
    expect(result.entities).toHaveLength(1)
    const firstEntity = result.entities[0]!
    expect(firstEntity.type).toBe('bold')
  })

  test('formatLlmOutput handles plain text', () => {
    const result = formatLlmOutput('plain text')
    expect(result.text).toBe('plain text')
    expect(result.entities).toHaveLength(0)
  })
})
