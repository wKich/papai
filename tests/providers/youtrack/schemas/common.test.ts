// tests/providers/youtrack/schemas/common.test.ts
import { describe, expect, test } from 'bun:test'

import { BaseEntitySchema, TimestampSchema } from '../../../../src/providers/youtrack/schemas/common.js'

describe('YouTrack common schemas', () => {
  test('BaseEntitySchema validates required fields', () => {
    const valid = {
      id: '123',
      $type: 'Issue',
    }
    expect(() => BaseEntitySchema.parse(valid)).not.toThrow()
  })

  test('TimestampSchema accepts number timestamps', () => {
    expect(TimestampSchema.parse(1700000000000)).toBe(1700000000000)
    expect(() => TimestampSchema.parse('not a number')).toThrow()
  })
})
