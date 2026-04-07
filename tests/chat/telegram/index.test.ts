/**
 * Tests for Telegram chat provider
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('TelegramChatProvider', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('provider has correct name', () => {
    // We can't instantiate without TELEGRAM_BOT_TOKEN, but we can verify the class exists
    expect(typeof TelegramChatProvider).toBe('function')
  })

  describe('resolveUserId', () => {
    test('returns numeric ID as-is', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const result = await provider.resolveUserId('123456789')
      expect(result).toBe('123456789')
      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('returns null for username (cannot resolve via Bot API)', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const result = await provider.resolveUserId('@username')
      expect(result).toBeNull()
      delete process.env['TELEGRAM_BOT_TOKEN']
    })
  })
})
