import { describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

// Mock logger
void mock.module('../src/logger.js', () => ({
  logger: {
    trace: (): void => {},
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
    fatal: (): void => {},
    level: 'info',
    child: (): object => ({
      trace: (): void => {},
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
      fatal: (): void => {},
      level: 'info',
    }),
  },
}))

import { cronMatches, describeCron, nextCronOccurrence, parseCron } from '../src/cron.js'

describe('parseCron', () => {
  test('parses a valid 5-field cron expression', () => {
    const result = parseCron('0 9 * * 1')
    expect(result).not.toBeNull()
    expect(result!.minute).toEqual({ type: 'values', values: [0] })
    expect(result!.hour).toEqual({ type: 'values', values: [9] })
    expect(result!.dayOfMonth).toEqual({ type: 'any', values: [] })
    expect(result!.month).toEqual({ type: 'any', values: [] })
    expect(result!.dayOfWeek).toEqual({ type: 'values', values: [1] })
  })

  test('returns null for invalid expression', () => {
    expect(parseCron('invalid')).toBeNull()
    expect(parseCron('1 2 3')).toBeNull()
    expect(parseCron('')).toBeNull()
  })

  test('parses ranges', () => {
    const result = parseCron('0 9 * * 1-5')
    expect(result).not.toBeNull()
    expect(result!.dayOfWeek).toEqual({ type: 'values', values: [1, 2, 3, 4, 5] })
  })

  test('parses comma-separated values', () => {
    const result = parseCron('0,30 * * * *')
    expect(result).not.toBeNull()
    expect(result!.minute).toEqual({ type: 'values', values: [0, 30] })
  })

  test('parses step values', () => {
    const result = parseCron('*/15 * * * *')
    expect(result).not.toBeNull()
    expect(result!.minute).toEqual({ type: 'values', values: [0, 15, 30, 45] })
  })

  test('returns null for zero step (*/0)', () => {
    // Zero step produces no values → parseCron returns null (invalid expression)
    expect(parseCron('*/0 * * * *')).toBeNull()
  })

  test('returns null for negative step (*/-1)', () => {
    // */-1 does not match the step regex so produces no values → parseCron returns null
    expect(parseCron('*/-1 * * * *')).toBeNull()
  })
})

describe('cronMatches', () => {
  test('matches every Monday at 9am UTC', () => {
    const cron = parseCron('0 9 * * 1')!
    // 2026-03-23 is a Monday
    const monday9am = new Date('2026-03-23T09:00:00Z')
    expect(cronMatches(cron, monday9am)).toBe(true)
  })

  test('does not match wrong day', () => {
    const cron = parseCron('0 9 * * 1')!
    // 2026-03-24 is a Tuesday
    const tuesday9am = new Date('2026-03-24T09:00:00Z')
    expect(cronMatches(cron, tuesday9am)).toBe(false)
  })

  test('does not match wrong time', () => {
    const cron = parseCron('0 9 * * 1')!
    const monday10am = new Date('2026-03-23T10:00:00Z')
    expect(cronMatches(cron, monday10am)).toBe(false)
  })

  test('matches wildcard for all fields', () => {
    const cron = parseCron('* * * * *')!
    expect(cronMatches(cron, new Date())).toBe(true)
  })
})

describe('nextCronOccurrence', () => {
  test('finds next Monday at 9am', () => {
    const cron = parseCron('0 9 * * 1')!
    // Start from Sunday 2026-03-22
    const sunday = new Date('2026-03-22T10:00:00Z')
    const next = nextCronOccurrence(cron, sunday)
    expect(next).not.toBeNull()
    // Monday
    expect(next!.getUTCDay()).toBe(1)
    expect(next!.getUTCHours()).toBe(9)
    expect(next!.getUTCMinutes()).toBe(0)
  })

  test('finds next occurrence for daily cron', () => {
    const cron = parseCron('30 14 * * *')!
    const now = new Date('2026-03-21T15:00:00Z')
    const next = nextCronOccurrence(cron, now)
    expect(next).not.toBeNull()
    expect(next!.getUTCHours()).toBe(14)
    expect(next!.getUTCMinutes()).toBe(30)
    // Should be the next day since 14:30 already passed
    expect(next!.getUTCDate()).toBe(22)
  })

  test('finds next occurrence for first of month', () => {
    const cron = parseCron('0 0 1 * *')!
    const now = new Date('2026-03-15T00:00:00Z')
    const next = nextCronOccurrence(cron, now)
    expect(next).not.toBeNull()
    expect(next!.getUTCDate()).toBe(1)
    // April (0-indexed)
    expect(next!.getUTCMonth()).toBe(3)
  })
})

describe('describeCron', () => {
  test('describes weekly Monday schedule', () => {
    const desc = describeCron('0 9 * * 1')
    expect(desc).toContain('09:00 UTC')
    expect(desc).toContain('Monday')
  })

  test('describes daily schedule', () => {
    const desc = describeCron('30 14 * * *')
    expect(desc).toContain('14:30 UTC')
  })

  test('returns expression for invalid input', () => {
    expect(describeCron('invalid')).toBe('invalid')
  })
})
