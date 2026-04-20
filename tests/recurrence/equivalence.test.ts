import { describe, it, expect } from 'bun:test'

import { nextCronOccurrence, parseCron } from '../../src/cron.js'
import { cronToRrule } from '../../src/recurrence-translator.js'
import { nextOccurrence } from '../../src/recurrence.js'

const patterns = [
  { cron: '0 9 * * *', name: 'every day 09:00' },
  { cron: '30 14 * * 1,3,5', name: 'MWF 14:30' },
  { cron: '0 8 15 * *', name: 'day 15 of month 08:00' },
  { cron: '0 9-17 * * 1-5', name: 'weekdays 09-17 hourly' },
  { cron: '0 9 1 1,4,7,10 *', name: 'quarterly day 1 09:00' },
]

const timezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo']

const anchors = [new Date('2026-03-07T12:00:00Z'), new Date('2026-11-01T05:00:00Z'), new Date('2026-06-15T12:00:00Z')]

// DTSTART must predate all anchors so that rrule-temporal does not treat the
// anchor itself as a DTSTART boundary and skip occurrences that fall between
// the anchor and the next day boundary.  A fixed epoch well before the test
// anchors is sufficient.
const DTSTART_UTC = '2025-01-01T00:00:00Z'

describe('cron engine vs facade equivalence', () => {
  for (const p of patterns) {
    for (const tz of timezones) {
      for (const anchor of anchors) {
        it(`${p.name} in ${tz} starting ${anchor.toISOString()}`, () => {
          const cron = parseCron(p.cron)!
          const translated = cronToRrule(p.cron, tz, DTSTART_UTC)!

          const cronResults: Date[] = []
          let cursor = anchor
          for (let i = 0; i < 10; i++) {
            const next = nextCronOccurrence(cron, cursor, tz)
            if (next === null) break
            cronResults.push(next)
            cursor = next
          }

          const facadeResults: Date[] = []
          let cursor2 = anchor
          for (let i = 0; i < 10; i++) {
            const next = nextOccurrence(
              { rrule: translated.rrule, dtstartUtc: translated.dtstartUtc, timezone: tz },
              cursor2,
            )
            if (next === null) break
            facadeResults.push(next)
            cursor2 = next
          }

          expect(facadeResults.map((d) => d.toISOString())).toEqual(cronResults.map((d) => d.toISOString()))
        })
      }
    }
  }
})
