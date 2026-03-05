import { describe, expect, test, beforeAll } from 'bun:test'

// Set required env vars before importing bot
beforeAll(() => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  process.env['TELEGRAM_USER_ID'] = '12345'
})

describe('bot', () => {
  test('module loads with env vars', async () => {
    // Import bot after setting env vars
    const { bot } = await import('./bot.js')
    expect(bot).toBeDefined()
  })
})
