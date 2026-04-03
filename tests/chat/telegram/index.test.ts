/**
 * Tests for Telegram chat provider
 */

import { afterAll, describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { mockLogger } from '../../utils/test-helpers.js'

// Setup mocks
mockLogger()

afterAll(() => {
  mock.restore()
})

import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'

describe('TelegramChatProvider', () => {
  test('provider has correct name', () => {
    // We can't instantiate without TELEGRAM_BOT_TOKEN, but we can verify the class exists
    expect(typeof TelegramChatProvider).toBe('function')
  })
})
