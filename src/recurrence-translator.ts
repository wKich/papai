import { logger } from './logger.js'

const log = logger.child({ scope: 'recurrence-translator' })

type CronField = { type: 'any' | 'values'; values: number[] }

type ParsedCron = {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

const parseRange = (range: string, min: number, max: number): [number, number] => {
  const parts = range.split('-')
  const start = Number.parseInt(parts[0] ?? String(min), 10)
  const end = Number.parseInt(parts[1] ?? String(max), 10)
  return [Math.max(min, Math.min(start, max)), Math.max(min, Math.min(end, max))]
}

const parseField = (field: string, min: number, max: number): CronField => {
  if (field === '*') return { type: 'any', values: [] }
  const values: number[] = []
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    if (stepMatch !== null) {
      const [, range, stepStr] = stepMatch
      const step = Number.parseInt(stepStr!, 10)
      if (step <= 0) {
        log.warn({ field, part }, 'Invalid cron step value')
        continue
      }
      const [start, end] = range === '*' ? [min, max] : parseRange(range!, min, max)
      for (let i = start; i <= end; i += step) values.push(i)
      continue
    }
    if (part.includes('-')) {
      const [start, end] = parseRange(part, min, max)
      for (let i = start; i <= end; i++) values.push(i)
      continue
    }
    const num = Number.parseInt(part, 10)
    if (!Number.isNaN(num) && num >= min && num <= max) values.push(num)
  }
  return { type: 'values', values }
}

const parseCron = (expression: string): ParsedCron | null => {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    log.warn({ expression }, 'Invalid cron expression: expected 5 fields')
    return null
  }
  const [minuteStr, hourStr, domStr, monthStr, dowStr] = fields
  const minute = parseField(minuteStr!, 0, 59)
  const hour = parseField(hourStr!, 0, 23)
  const dayOfMonth = parseField(domStr!, 1, 31)
  const month = parseField(monthStr!, 1, 12)
  const dayOfWeek = parseField(dowStr!, 0, 6)
  const invalidField =
    (minute.type === 'values' && minute.values.length === 0) ||
    (hour.type === 'values' && hour.values.length === 0) ||
    (dayOfMonth.type === 'values' && dayOfMonth.values.length === 0) ||
    (month.type === 'values' && month.values.length === 0) ||
    (dayOfWeek.type === 'values' && dayOfWeek.values.length === 0)
  if (invalidField) {
    log.warn({ expression }, 'Invalid cron expression: field produced no valid values')
    return null
  }
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

const DAY_ABBR = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export type TranslatorResult = {
  rrule: string
  dtstartUtc: string
  timezone: string
}

export const cronToRrule = (expression: string, timezone: string, dtstartUtc: string): TranslatorResult | null => {
  const parsed = parseCron(expression)
  if (parsed === null) return null

  const byDay = parsed.dayOfWeek.type === 'values' ? parsed.dayOfWeek.values.map((d) => DAY_ABBR[d]!).join(',') : null
  const byMonth = parsed.month.type === 'values' ? parsed.month.values.join(',') : null
  const byMonthDay = parsed.dayOfMonth.type === 'values' ? parsed.dayOfMonth.values.join(',') : null
  const byHour = parsed.hour.type === 'values' ? parsed.hour.values.join(',') : null
  const byMinute = parsed.minute.type === 'values' ? parsed.minute.values.join(',') : null

  let freq: 'YEARLY' | 'MONTHLY' | 'WEEKLY' | 'DAILY' | 'HOURLY'

  if (parsed.month.type === 'values') {
    freq = 'YEARLY'
  } else if (parsed.dayOfMonth.type === 'values') {
    freq = 'MONTHLY'
  } else if (parsed.dayOfWeek.type === 'values') {
    freq = 'WEEKLY'
  } else if (parsed.hour.type === 'any' && parsed.minute.type === 'values') {
    freq = 'HOURLY'
  } else {
    freq = 'DAILY'
  }

  const parts: string[] = [`FREQ=${freq}`]
  if (freq === 'YEARLY' && byMonth !== null) parts.push(`BYMONTH=${byMonth}`)
  if (byMonthDay !== null) parts.push(`BYMONTHDAY=${byMonthDay}`)
  if (byDay !== null && freq !== 'YEARLY' && freq !== 'MONTHLY') parts.push(`BYDAY=${byDay}`)
  if (byHour !== null && freq !== 'HOURLY') parts.push(`BYHOUR=${byHour}`)
  if (byMinute !== null) parts.push(`BYMINUTE=${byMinute}`)

  log.debug({ expression, freq }, 'cronToRrule translated')

  return { rrule: parts.join(';'), dtstartUtc, timezone }
}
