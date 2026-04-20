import { parseCron } from './cron.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'recurrence-translator' })

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
