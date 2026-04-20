import { RRuleTemporal } from 'rrule-temporal'

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

export type ParseResult = { ok: true; iter: RRuleTemporal } | { ok: false; reason: string }

const buildIcs = (args: CompiledRecurrence): string => {
  const dt = args.dtstartUtc
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
    .replace(/Z$/, '')
  return `DTSTART;TZID=${args.timezone}:${dt}\nRRULE:${args.rrule}`
}

export const parseRrule = (args: CompiledRecurrence): ParseResult => {
  try {
    const iter = new RRuleTemporal({ rruleString: buildIcs(args) })
    return { ok: true, iter }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.warn({ rrule: args.rrule, reason }, 'parseRrule failed')
    return { ok: false, reason }
  }
}

export const nextOccurrence = (args: CompiledRecurrence, after: Date): Date | null => {
  const parsed = parseRrule(args)
  if (!parsed.ok) return null
  const next = parsed.iter.next(after)
  return next === null ? null : new Date(next.epochMilliseconds)
}

export const occurrencesBetween = (args: CompiledRecurrence, after: Date, before: Date, limit = 100): Date[] => {
  const parsed = parseRrule(args)
  if (!parsed.ok) return []
  const results: Date[] = []
  for (const dt of parsed.iter.between(after, before, true)) {
    results.push(new Date(dt.epochMilliseconds))
    if (results.length >= limit) break
  }
  return results
}
