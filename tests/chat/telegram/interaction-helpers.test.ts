import { describe, expect, test } from 'bun:test'

import { buildTelegramInteraction } from '../../../src/chat/telegram/interaction-helpers.js'

describe('buildTelegramInteraction', () => {
  test('maps callback query data into an incoming interaction', () => {
    const interaction = buildTelegramInteraction(
      {
        from: { id: 42, username: 'alice' },
        chat: { id: 99, type: 'private' },
        callbackQuery: {
          data: 'cfg:edit:timezone',
          message: { message_id: 7, message_thread_id: 5 },
        },
      },
      true,
    )

    expect(interaction).toEqual({
      kind: 'button',
      user: { id: '42', username: 'alice', isAdmin: true },
      contextId: '99',
      contextType: 'dm',
      callbackData: 'cfg:edit:timezone',
      messageId: '7',
      threadId: '5',
    })
  })

  test('returns null when callback data is missing', () => {
    const interaction = buildTelegramInteraction(
      { from: { id: 42 }, chat: { id: 99, type: 'private' }, callbackQuery: {} },
      false,
    )

    expect(interaction).toBeNull()
  })
})
