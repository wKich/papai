import { describe, expect, test } from 'bun:test'

import { localDatetimeToUtc, semanticScheduleToCron, utcToLocal } from '../../src/utils/datetime.js'

describe('localDatetimeToUtc', () => {
  test('converts date+time in UTC (no offset)', () => {
    expect(localDatetimeToUtc('2026-03-25', '09:00', 'UTC')).toBe('2026-03-25T09:00:00.000Z')
  })

  test('converts date+time for east-of-UTC timezone (UTC+5)', () => {
    // Asia/Karachi is UTC+5, no DST
    // 17:00 local = 12:00 UTC
    expect(localDatetimeToUtc('2026-03-25', '17:00', 'Asia/Karachi')).toBe('2026-03-25T12:00:00.000Z')
  })

  test('converts date-only to local midnight', () => {
    // midnight Karachi (UTC+5) = 19:00 UTC previous day
    expect(localDatetimeToUtc('2026-03-25', undefined, 'Asia/Karachi')).toBe('2026-03-24T19:00:00.000Z')
  })

  test('converts date+time for west-of-UTC timezone (UTC-5)', () => {
    // America/New_York in winter is UTC-5
    // 09:00 NY = 14:00 UTC
    expect(localDatetimeToUtc('2026-01-15', '09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z')
  })

  test('converts date+time for UTC-8 (America/Los_Angeles in standard time)', () => {
    // 2026-01-10 is winter; LA = UTC-8
    expect(localDatetimeToUtc('2026-01-10', '10:00', 'America/Los_Angeles')).toBe('2026-01-10T18:00:00.000Z')
  })

  test('falls back to treating time as UTC when timezone is invalid', () => {
    expect(localDatetimeToUtc('2026-03-25', '09:00', 'Not/ATimezone')).toBe('2026-03-25T09:00:00.000Z')
  })
})

describe('semanticScheduleToCron', () => {
  test('daily', () => {
    expect(semanticScheduleToCron({ frequency: 'daily', time: '09:00' })).toBe('0 9 * * *')
  })

  test('daily with leading-zero hours', () => {
    expect(semanticScheduleToCron({ frequency: 'daily', time: '09:05' })).toBe('5 9 * * *')
  })

  test('weekdays', () => {
    expect(semanticScheduleToCron({ frequency: 'weekdays', time: '09:00' })).toBe('0 9 * * 1-5')
  })

  test('weekends', () => {
    expect(semanticScheduleToCron({ frequency: 'weekends', time: '10:00' })).toBe('0 10 * * 0,6')
  })

  test('weekly on a single day', () => {
    expect(semanticScheduleToCron({ frequency: 'weekly', time: '09:00', days_of_week: ['mon'] })).toBe('0 9 * * 1')
  })

  test('weekly on multiple days', () => {
    expect(semanticScheduleToCron({ frequency: 'weekly', time: '09:00', days_of_week: ['mon', 'wed', 'fri'] })).toBe(
      '0 9 * * 1,3,5',
    )
  })

  test('weekly with no days_of_week defaults to every day', () => {
    expect(semanticScheduleToCron({ frequency: 'weekly', time: '09:00' })).toBe('0 9 * * *')
  })

  test('monthly with explicit day', () => {
    expect(semanticScheduleToCron({ frequency: 'monthly', time: '10:00', day_of_month: 15 })).toBe('0 10 15 * *')
  })

  test('monthly without day defaults to 1st', () => {
    expect(semanticScheduleToCron({ frequency: 'monthly', time: '10:00' })).toBe('0 10 1 * *')
  })
})

describe('utcToLocal', () => {
  test('converts UTC to local time in east-of-UTC timezone', () => {
    // 12:00 UTC = 17:00 Asia/Karachi (UTC+5, no DST)
    expect(utcToLocal('2026-03-25T12:00:00.000Z', 'Asia/Karachi')).toBe('2026-03-25T17:00:00')
  })

  test('converts UTC to local time in west-of-UTC timezone', () => {
    // 14:00 UTC = 09:00 America/New_York in winter (UTC-5)
    expect(utcToLocal('2026-01-15T14:00:00.000Z', 'America/New_York')).toBe('2026-01-15T09:00:00')
  })

  test('returns null for null input', () => {
    expect(utcToLocal(null, 'Asia/Karachi')).toBeNull()
  })

  test('returns undefined for undefined input', () => {
    expect(utcToLocal(undefined, 'Asia/Karachi')).toBeUndefined()
  })

  test('falls back to original string on unparseable input', () => {
    expect(utcToLocal('not-a-date', 'Asia/Karachi')).toBe('not-a-date')
  })
})
