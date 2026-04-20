import { logger } from './logger.js'
import type { RecurrenceSpec } from './types/recurrence.js'

const log = logger.child({ scope: 'recurrence' })

export type CompiledRecurrence = {
  rrule: string
  dtstartUtc: string
  timezone: string
}

export const recurrenceSpecToRrule = (spec: RecurrenceSpec): CompiledRecurrence => {
  log.debug({ freq: spec.freq, timezone: spec.timezone }, 'recurrenceSpecToRrule called')

  const parts: string[] = [`FREQ=${spec.freq}`]
  if (spec.interval !== undefined) parts.push(`INTERVAL=${spec.interval}`)
  if (spec.count !== undefined) parts.push(`COUNT=${spec.count}`)
  if (spec.until !== undefined) {
    const until = spec.until.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    parts.push(`UNTIL=${until}`)
  }
  if (spec.byMonth !== undefined) parts.push(`BYMONTH=${spec.byMonth.join(',')}`)
  if (spec.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${spec.byMonthDay.join(',')}`)
  if (spec.byDay !== undefined) parts.push(`BYDAY=${spec.byDay.join(',')}`)
  if (spec.byHour !== undefined) parts.push(`BYHOUR=${spec.byHour.join(',')}`)
  if (spec.byMinute !== undefined) parts.push(`BYMINUTE=${spec.byMinute.join(',')}`)

  return {
    rrule: parts.join(';'),
    dtstartUtc: spec.dtstart,
    timezone: spec.timezone,
  }
}
