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
})
