import { beforeEach, describe, expect, test } from 'bun:test'

import { createDiscordReplyFn, type SendableChannel } from '../../../src/chat/discord/reply-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

type SendArg = {
  content?: string
  components?: unknown[]
  reply?: { messageReference: string; failIfNotExists: boolean }
}

describe('createDiscordReplyFn', () => {
  beforeEach(() => {
    mockLogger()
  })

  function makeChannel(): { sends: SendArg[]; typingCalls: number[]; channel: SendableChannel } {
    const sends: SendArg[] = []
    const typingCalls: number[] = []
    return {
      sends,
      typingCalls,
      channel: {
        id: 'chan-1',
        send: (arg: SendArg) => {
          sends.push(arg)
          return Promise.resolve({ id: `bot-msg-${String(sends.length)}`, edit: () => Promise.resolve() })
        },
        sendTyping: () => {
          typingCalls.push(Date.now())
          return Promise.resolve()
        },
      },
    }
  }

  test('text() sends content via channel.send', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await reply.text('hello')
    expect(sends).toHaveLength(1)
    expect(sends[0]!.content).toBe('hello')
  })

  test('text() sets reply.messageReference when replyToMessageId is provided', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: 'parent-1' })
    await reply.text('yo')
    expect(sends[0]!.reply?.messageReference).toBe('parent-1')
    expect(sends[0]!.reply?.failIfNotExists).toBe(false)
  })

  test('formatted() chunks long input into multiple sends', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await reply.formatted('x'.repeat(4500))
    expect(sends.length).toBeGreaterThanOrEqual(3)
    for (const s of sends) {
      expect((s.content ?? '').length).toBeLessThanOrEqual(2000)
    }
  })

  test('typing() calls channel.sendTyping', () => {
    const { channel, typingCalls } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    reply.typing()
    expect(typingCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('file() throws a clear deferral error', async () => {
    const { channel } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await expect(reply.file({ content: Buffer.from('data'), filename: 'x.txt' })).rejects.toThrow(
      /Discord file send not implemented/,
    )
  })

  test('redactMessage() edits the last bot-authored message', async () => {
    const { channel } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await reply.text('first reply')
    await expect(reply.redactMessage!('[redacted]')).resolves.toBeUndefined()
  })

  test('buttons() builds action rows and sends', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await reply.buttons('choose', {
      buttons: [
        { text: 'Yes', callbackData: 'cb:y', style: 'primary' },
        { text: 'No', callbackData: 'cb:n', style: 'danger' },
      ],
    })
    expect(sends).toHaveLength(1)
    expect(sends[0]!.content).toBe('choose')
    expect(Array.isArray(sends[0]!.components)).toBe(true)
    expect((sends[0]!.components ?? []).length).toBe(1)
  })
})
