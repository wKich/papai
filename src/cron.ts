/**
 * Lightweight cron expression parser.
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 *
 * Examples:
 *   "0 9 * * 1"     → every Monday at 09:00
 *   "30 14 * * *"   → every day at 14:30
 *   "0 0 1 * *"     → first of every month at midnight
 *   "0 9 * * 1-5"   → weekdays at 09:00
 */

import { logger } from './logger.js'

const log = logger.child({ scope: 'cron' })

type CronField = {
  type: 'any' | 'values'
  values: number[]
}

type ParsedCron = {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

const parseField = (field: string, min: number, max: number): CronField => {
  if (field === '*') {
    return { type: 'any', values: [] }
  }

  const values: number[] = []

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    if (stepMatch !== null) {
      const [, range, stepStr] = stepMatch
      const step = Number.parseInt(stepStr!, 10)
      const [start, end] = range === '*' ? [min, max] : parseRange(range!, min, max)
      for (let i = start; i <= end; i += step) {
        values.push(i)
      }
      continue
    }

    if (part.includes('-')) {
      const [start, end] = parseRange(part, min, max)
      for (let i = start; i <= end; i++) {
        values.push(i)
      }
      continue
    }

    const num = Number.parseInt(part, 10)
    if (!Number.isNaN(num) && num >= min && num <= max) {
      values.push(num)
    }
  }

  return { type: 'values', values }
}

const parseRange = (range: string, min: number, max: number): [number, number] => {
  const parts = range.split('-')
  const start = Number.parseInt(parts[0] ?? String(min), 10)
  const end = Number.parseInt(parts[1] ?? String(max), 10)
  return [Math.max(min, Math.min(start, max)), Math.max(min, Math.min(end, max))]
}

export const parseCron = (expression: string): ParsedCron | null => {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    log.warn({ expression }, 'Invalid cron expression: expected 5 fields')
    return null
  }

  const [minuteStr, hourStr, domStr, monthStr, dowStr] = fields

  return {
    minute: parseField(minuteStr!, 0, 59),
    hour: parseField(hourStr!, 0, 23),
    dayOfMonth: parseField(domStr!, 1, 31),
    month: parseField(monthStr!, 1, 12),
    dayOfWeek: parseField(dowStr!, 0, 6),
  }
}

const fieldMatches = (field: CronField, value: number): boolean => {
  if (field.type === 'any') return true
  return field.values.includes(value)
}

/** Check if a given date matches the cron expression. */
export const cronMatches = (cron: ParsedCron, date: Date): boolean =>
  fieldMatches(cron.minute, date.getUTCMinutes()) &&
  fieldMatches(cron.hour, date.getUTCHours()) &&
  fieldMatches(cron.dayOfMonth, date.getUTCDate()) &&
  fieldMatches(cron.month, date.getUTCMonth() + 1) &&
  fieldMatches(cron.dayOfWeek, date.getUTCDay())

/**
 * Compute the next occurrence after `after` that matches the cron expression.
 * Searches minute-by-minute for up to 366 days.
 */
export const nextCronOccurrence = (cron: ParsedCron, after: Date): Date | null => {
  // Start from the next whole minute
  const candidate = new Date(after.getTime())
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)

  // Max iterations: ~1 year of minutes
  const limit = 366 * 24 * 60

  for (let i = 0; i < limit; i++) {
    if (cronMatches(cron, candidate)) {
      return candidate
    }

    // Optimize: if hour doesn't match, skip to next hour
    if (!fieldMatches(cron.hour, candidate.getUTCHours())) {
      candidate.setUTCHours(candidate.getUTCHours() + 1)
      candidate.setUTCMinutes(0)
      i += 59
      continue
    }

    // If day doesn't match, skip to next day
    if (
      !fieldMatches(cron.dayOfMonth, candidate.getUTCDate()) ||
      !fieldMatches(cron.month, candidate.getUTCMonth() + 1) ||
      !fieldMatches(cron.dayOfWeek, candidate.getUTCDay())
    ) {
      candidate.setUTCDate(candidate.getUTCDate() + 1)
      candidate.setUTCHours(0)
      candidate.setUTCMinutes(0)
      i += 24 * 60
      continue
    }

    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  }

  log.warn({ after: after.toISOString() }, 'Could not find next cron occurrence within 366 days')
  return null
}

/**
 * Describes a cron expression in human-readable form.
 */
export const describeCron = (expression: string): string => {
  const cron = parseCron(expression)
  if (cron === null) return expression

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const monthNames = [
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

  const parts: string[] = []

  // Time
  if (cron.minute.type === 'values' && cron.hour.type === 'values') {
    const h = cron.hour.values[0] ?? 0
    const m = cron.minute.values[0] ?? 0
    parts.push(`at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`)
  }

  // Day of week
  if (cron.dayOfWeek.type === 'values') {
    const names = cron.dayOfWeek.values.map((d) => dayNames[d] ?? String(d))
    parts.push(`on ${names.join(', ')}`)
  }

  // Day of month
  if (cron.dayOfMonth.type === 'values') {
    parts.push(`on day ${cron.dayOfMonth.values.join(', ')} of the month`)
  }

  // Month
  if (cron.month.type === 'values') {
    const names = cron.month.values.map((m) => monthNames[m] ?? String(m))
    parts.push(`in ${names.join(', ')}`)
  }

  if (parts.length === 0) return 'every minute'
  return parts.join(' ')
}
