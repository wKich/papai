import { describe, expect, test } from 'bun:test'

import { DISCORD_CUSTOM_ID_MAX, toActionRows } from '../../../src/chat/discord/buttons.js'
import type { ChatButton } from '../../../src/chat/types.js'

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
