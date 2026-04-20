import { describe, it, expect } from 'bun:test'

import { recurrenceSpecSchema, recurringTriggerSchema } from '../../src/types/recurrence.js'

describe('recurrenceSpecSchema', () => {
  it('accepts a minimal weekly spec', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'WEEKLY',
      byDay: ['MO', 'WE', 'FR'],
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'Europe/London',
    })
    expect(result.success).toBe(true)
  })

  it('rejects conflicting until and count', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      until: '2026-12-31T00:00:00Z',
      count: 10,
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid byDay values', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'WEEKLY',
      byDay: ['FUNDAY'],
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid timezone', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'Not/A_Zone',
    })
    expect(result.success).toBe(false)
  })

  it('rejects interval < 1', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      interval: 0,
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })
})

describe('recurringTriggerSchema (discriminated union)', () => {
  it('accepts on_complete with no recurrence', () => {
    const result = recurringTriggerSchema.safeParse({ triggerType: 'on_complete' })
    expect(result.success).toBe(true)
  })

  it('accepts cron with a valid spec', () => {
    const result = recurringTriggerSchema.safeParse({
      triggerType: 'cron',
      recurrence: {
        freq: 'DAILY',
        dtstart: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects cron without a recurrence', () => {
    const result = recurringTriggerSchema.safeParse({ triggerType: 'cron' })
    expect(result.success).toBe(false)
  })
})
