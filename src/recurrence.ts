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

const DAY_NAMES: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
}

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const pad2 = (n: number): string => String(n).padStart(2, '0')

const localTimeOfDay = (spec: RecurrenceSpec): { hour: number; minute: number } => {
  if (spec.byHour !== undefined && spec.byMinute !== undefined) {
    return { hour: spec.byHour[0] ?? 0, minute: spec.byMinute[0] ?? 0 }
  }
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: spec.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(spec.dtstart))
  const hh = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const mm = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  return { hour: hh === 24 ? 0 : hh, minute: mm }
}

const parseRruleParts = (rruleStr: string): Record<string, string> => {
  const parts: Record<string, string> = {}
  for (const part of rruleStr.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    parts[part.slice(0, idx).toUpperCase()] = part.slice(idx + 1)
  }
  return parts
}

export const describeCompiledRecurrence = (compiled: CompiledRecurrence): string => {
  const parts = parseRruleParts(compiled.rrule)
  const descParts: string[] = []

  const byHourStr = parts['BYHOUR']
  const byMinuteStr = parts['BYMINUTE']
  const byDayStr = parts['BYDAY']
  const byMonthDayStr = parts['BYMONTHDAY']
  const byMonthStr = parts['BYMONTH']

  const hour = byHourStr === undefined ? 0 : Number.parseInt(byHourStr.split(',')[0] ?? '0', 10)
  const minute = byMinuteStr === undefined ? 0 : Number.parseInt(byMinuteStr.split(',')[0] ?? '0', 10)

  descParts.push(`at ${pad2(hour)}:${pad2(minute)} ${compiled.timezone}`)

  if (byDayStr !== undefined) {
    const names = byDayStr.split(',').map((d) => DAY_NAMES[d] ?? d)
    descParts.push(`on ${names.join(', ')}`)
  }

  if (byMonthDayStr !== undefined) {
    descParts.push(`on day ${byMonthDayStr} of the month`)
  }

  if (byMonthStr !== undefined) {
    const nums = byMonthStr.split(',').map((n) => Number.parseInt(n, 10))
    const names = nums.map((m) => MONTH_NAMES[m] ?? String(m))
    descParts.push(`in ${names.join(', ')}`)
  }

  return descParts.join(' ')
}

export const describeRecurrence = (spec: RecurrenceSpec): string => {
  const parts: string[] = []
  const { hour, minute } = localTimeOfDay(spec)

  const FREQ_WORD: Record<string, string> = {
    DAILY: 'day',
    WEEKLY: 'week',
    MONTHLY: 'month',
    YEARLY: 'year',
  }

  if (spec.byDay === undefined && spec.byMonthDay === undefined && spec.byMonth === undefined) {
    parts.push(`every ${FREQ_WORD[spec.freq] ?? spec.freq.toLowerCase()}`)
  }

  parts.push(`at ${pad2(hour)}:${pad2(minute)} ${spec.timezone}`)

  if (spec.byDay !== undefined) {
    const names = spec.byDay.map((d) => DAY_NAMES[d] ?? d)
    parts.push(`on ${names.join(', ')}`)
  }

  if (spec.byMonthDay !== undefined) {
    parts.push(`on day ${spec.byMonthDay.join(', ')} of the month`)
  }

  if (spec.byMonth !== undefined) {
    const names = spec.byMonth.map((m) => MONTH_NAMES[m] ?? String(m))
    parts.push(`in ${names.join(', ')}`)
  }

  return parts.join(' ')
}
