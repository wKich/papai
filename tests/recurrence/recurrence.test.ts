import { describe, it, expect } from 'bun:test'

import { recurrenceSpecToRrule } from '../../src/recurrence.js'
import type { RecurrenceSpec } from '../../src/types/recurrence.js'

describe('recurrenceSpecToRrule', () => {
  it('serialises a WEEKLY MO/WE/FR at 09:00 spec', () => {
    const spec: RecurrenceSpec = {
      freq: 'WEEKLY',
      byDay: ['MO', 'WE', 'FR'],
      byHour: [9],
      byMinute: [0],
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'Europe/London',
    }
    const out = recurrenceSpecToRrule(spec)
    expect(out.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0')
    expect(out.dtstartUtc).toBe('2026-04-20T09:00:00Z')
    expect(out.timezone).toBe('Europe/London')
  })

  it('omits BYHOUR/BYMINUTE when not provided (DTSTART-time semantics)', () => {
    const spec: RecurrenceSpec = {
      freq: 'DAILY',
      dtstart: '2026-04-20T09:30:00Z',
      timezone: 'UTC',
    }
    const out = recurrenceSpecToRrule(spec)
    expect(out.rrule).toBe('FREQ=DAILY')
  })

  it('serialises INTERVAL, COUNT, UNTIL', () => {
    const spec: RecurrenceSpec = {
      freq: 'DAILY',
      interval: 2,
      count: 10,
      dtstart: '2026-04-20T00:00:00Z',
      timezone: 'UTC',
    }
    const out = recurrenceSpecToRrule(spec)
    expect(out.rrule).toBe('FREQ=DAILY;INTERVAL=2;COUNT=10')
  })

  it('serialises BYMONTH, BYMONTHDAY', () => {
    const spec: RecurrenceSpec = {
      freq: 'YEARLY',
      byMonth: [1, 4, 7, 10],
      byMonthDay: [1],
      dtstart: '2026-01-01T09:00:00Z',
      timezone: 'UTC',
    }
    const out = recurrenceSpecToRrule(spec)
    expect(out.rrule).toBe('FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1')
  })
})
