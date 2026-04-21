import { describe, expect, test } from 'bun:test'

import { localDatetimeToUtc, utcToLocal } from '../../src/utils/datetime.js'

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

  test('falls back to treating time as UTC when timezone is empty string', () => {
    expect(localDatetimeToUtc('2026-03-25', '09:00', '')).toBe('2026-03-25T09:00:00.000Z')
  })

  test('applies correct standard-time offset (UTC-5) just before spring-forward', () => {
    // 2026-03-08 01:59 EST = UTC-5 → 06:59 UTC
    expect(localDatetimeToUtc('2026-03-08', '01:59', 'America/New_York')).toBe('2026-03-08T06:59:00.000Z')
  })

  test('applies correct daylight-time offset (UTC-4) just after spring-forward', () => {
    // 2026-03-08 03:00 EDT = UTC-4 → 07:00 UTC
    // (clocks jumped from 2:00 AM to 3:00 AM so 3:00 AM is the first valid EDT time)
    expect(localDatetimeToUtc('2026-03-08', '03:00', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z')
  })

  test('applies correct daylight-time offset (UTC-4) in summer', () => {
    // America/New_York in summer is UTC-4
    // 2026-07-15 09:00 EDT = 13:00 UTC
    expect(localDatetimeToUtc('2026-07-15', '09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z')
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
