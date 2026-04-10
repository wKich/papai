import { describe, expect, test, beforeEach } from 'bun:test'

import {
  DISCORD_CUSTOM_ID_MAX,
  dispatchButtonInteraction,
  toActionRows,
  type ButtonChannelLike,
  type ButtonInteractionLike,
} from '../../../src/chat/discord/buttons.js'
import type { ChatButton } from '../../../src/chat/types.js'
import { mockLogger } from '../../utils/test-helpers.js'

type EditFn = (arg: { content?: string; components?: unknown[] }) => Promise<unknown>
type SendResult = { id: string; edit: EditFn }

function fakeChannel(id = 'c'): ButtonChannelLike {
  return {
    id,
    type: 0,
    send: (): Promise<SendResult> => Promise.resolve({ id: 'x', edit: (): Promise<void> => Promise.resolve() }),
    sendTyping: (): Promise<void> => Promise.resolve(),
  }
}

describe('toActionRows', () => {
  test('builds a single row for up to 5 buttons', () => {
    const buttons: ChatButton[] = [
      { text: 'A', callbackData: 'cb:a', style: 'primary' },
      { text: 'B', callbackData: 'cb:b', style: 'secondary' },
    ]
    const rows = toActionRows(buttons)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.components).toHaveLength(2)
  })

  test('splits into multiple rows of 5', () => {
    const buttons: ChatButton[] = Array.from({ length: 12 }, (_, i) => ({
      text: `btn${String(i)}`,
      callbackData: `cb:${String(i)}`,
    }))
    const rows = toActionRows(buttons)
    expect(rows).toHaveLength(3)
    expect(rows[0]!.components).toHaveLength(5)
    expect(rows[1]!.components).toHaveLength(5)
    expect(rows[2]!.components).toHaveLength(2)
  })

  test('rejects more than 25 buttons (5 rows x 5)', () => {
    const buttons: ChatButton[] = Array.from({ length: 26 }, (_, i) => ({
      text: `b${String(i)}`,
      callbackData: `cb:${String(i)}`,
    }))
    expect(() => toActionRows(buttons)).toThrow(/too many buttons/i)
  })

  test('rejects custom_id longer than 100 chars', () => {
    const long = 'x'.repeat(DISCORD_CUSTOM_ID_MAX + 1)
    expect(() => toActionRows([{ text: 'Go', callbackData: long }])).toThrow(/custom_id/)
  })

  test('defaults to secondary style when style is undefined', () => {
    const rows = toActionRows([{ text: 'neutral', callbackData: 'cb:n' }])
    // ButtonBuilder stores data internally; access via toJSON()
    const json = rows[0]!.components[0]!.toJSON()
    // Secondary = 2 in Discord ButtonStyle enum
    expect(json.style).toBe(2)
  })

  test('maps primary/secondary/danger to ButtonStyle enum values', () => {
    const buttons: ChatButton[] = [
      { text: 'P', callbackData: 'cb:p', style: 'primary' },
      { text: 'S', callbackData: 'cb:s', style: 'secondary' },
      { text: 'D', callbackData: 'cb:d', style: 'danger' },
    ]
    const rows = toActionRows(buttons)
    const styles = rows[0]!.components.map((c) => c.toJSON().style)
    // Primary=1, Secondary=2, Danger=4
    expect(styles).toEqual([1, 2, 4])
  })
})

describe('dispatchButtonInteraction', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('routes cfg:-prefixed interactions through config-editor handler', async () => {
    const cfgCalls: string[] = []
    const wizardCalls: string[] = []
    const interaction: ButtonInteractionLike = {
      customId: 'cfg:edit:llm_apikey',
      deferUpdate: () => Promise.resolve(),
      user: { id: 'user-1', username: 'testuser' },
      message: { id: 'msg-1' },
      channel: fakeChannel('chan-1'),
      channelId: 'chan-1',
    }

    await dispatchButtonInteraction(
      interaction,
      (data: string): Promise<void> => {
        cfgCalls.push(data)
        return Promise.resolve()
      },
      (data: string): Promise<void> => {
        wizardCalls.push(data)
        return Promise.resolve()
      },
    )

    expect(cfgCalls).toEqual(['cfg:edit:llm_apikey'])
    expect(wizardCalls).toEqual([])
  })

  test('routes wizard_-prefixed interactions through wizard handler', async () => {
    const cfgCalls: string[] = []
    const wizardCalls: string[] = []
    const interaction: ButtonInteractionLike = {
      customId: 'wizard_confirm',
      deferUpdate: () => Promise.resolve(),
      user: { id: 'user-2', username: 'testuser2' },
      message: { id: 'msg-2' },
      channel: fakeChannel('chan-2'),
      channelId: 'chan-2',
    }

    await dispatchButtonInteraction(
      interaction,
      (data: string): Promise<void> => {
        cfgCalls.push(data)
        return Promise.resolve()
      },
      (data: string): Promise<void> => {
        wizardCalls.push(data)
        return Promise.resolve()
      },
    )

    expect(cfgCalls).toEqual([])
    expect(wizardCalls).toEqual(['wizard_confirm'])
  })

  test('ignores unrecognized interactions', async () => {
    const cfgCalls: string[] = []
    const wizardCalls: string[] = []
    const interaction: ButtonInteractionLike = {
      customId: 'some_random_callback',
      deferUpdate: () => Promise.resolve(),
      user: { id: 'u', username: 'user' },
      message: { id: 'm' },
      channel: fakeChannel(),
      channelId: 'c',
    }

    await dispatchButtonInteraction(
      interaction,
      (d: string): Promise<void> => {
        cfgCalls.push(d)
        return Promise.resolve()
      },
      (d: string): Promise<void> => {
        wizardCalls.push(d)
        return Promise.resolve()
      },
    )

    expect(cfgCalls).toEqual([])
    expect(wizardCalls).toEqual([])
  })

  test('handles deferUpdate failure gracefully', async () => {
    const cfgCalls: string[] = []
    const interaction: ButtonInteractionLike = {
      customId: 'cfg:save:main_model',
      deferUpdate: (): Promise<void> => Promise.reject(new Error('Network error')),
      user: { id: 'u', username: 'user' },
      message: { id: 'm' },
      channel: fakeChannel(),
      channelId: 'c',
    }

    await dispatchButtonInteraction(
      interaction,
      (d: string): Promise<void> => {
        cfgCalls.push(d)
        return Promise.resolve()
      },
      (): Promise<void> => Promise.resolve(),
    )

    // Handler should still be called despite deferUpdate failure
    expect(cfgCalls).toEqual(['cfg:save:main_model'])
  })
})

describe('isButtonInteraction', () => {
  test('returns true for button interactions (type=3, componentType=2)', async () => {
    const { isButtonInteraction } = await import('../../../src/chat/discord/buttons.js')
    const obj = {
      type: 3,
      componentType: 2,
      user: { id: 'u1', username: 'test' },
      customId: 'x',
      channelId: 'c1',
      channel: null,
      message: { id: 'm1' },
      deferUpdate: (): Promise<void> => Promise.resolve(),
    }
    expect(isButtonInteraction(obj)).toBe(true)
  })

  test('returns false for non-button component types', async () => {
    const { isButtonInteraction } = await import('../../../src/chat/discord/buttons.js')
    expect(isButtonInteraction({ type: 3, componentType: 3 })).toBe(false)
  })

  test('returns false for non-component interaction types', async () => {
    const { isButtonInteraction } = await import('../../../src/chat/discord/buttons.js')
    expect(isButtonInteraction({ type: 2, componentType: 2 })).toBe(false)
  })

  test('returns false for non-objects', async () => {
    const { isButtonInteraction } = await import('../../../src/chat/discord/buttons.js')
    expect(isButtonInteraction(null)).toBe(false)
    expect(isButtonInteraction('string')).toBe(false)
    expect(isButtonInteraction(42)).toBe(false)
  })

  test('returns false for objects without type/componentType', async () => {
    const { isButtonInteraction } = await import('../../../src/chat/discord/buttons.js')
    expect(isButtonInteraction({})).toBe(false)
    expect(isButtonInteraction({ type: 3 })).toBe(false)
  })
})

describe('Button types', () => {
  test('ButtonInteractionLike type accepts valid interaction objects', () => {
    const validInteraction: ButtonInteractionLike = {
      user: { id: 'u1', username: 'test' },
      customId: 'test:action',
      channelId: 'c1',
      channel: fakeChannel('c1'),
      message: { id: 'm1' },
      deferUpdate: (): Promise<void> => Promise.resolve(),
    }
    expect(validInteraction.customId).toBe('test:action')
  })

  test('ButtonChannelLike type accepts valid channel objects', () => {
    const validChannel: ButtonChannelLike = fakeChannel('c1')
    expect(validChannel.id).toBe('c1')
  })
})
