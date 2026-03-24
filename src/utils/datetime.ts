import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export type LocalDatetime = {
  /** YYYY-MM-DD */
  date: string
  /** HH:MM (24-hour) */
  time?: string
}

export type SemanticSchedule = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'weekends'
  /** HH:MM (24-hour, user's local timezone) */
  time: string
  days_of_week?: Array<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'>
  day_of_month?: number
}

const DAY_OF_WEEK_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

/**
 * Convert a local date+time in a named IANA timezone to a UTC ISO string.
 *
 * Uses date-fns-tz `fromZonedTime` which handles DST correctly. Falls back
 * to treating the time as UTC when the timezone identifier is invalid.
 */
export const localDatetimeToUtc = (date: string, time: string | undefined, timezone: string): string => {
  // fromZonedTime accepts "YYYY-MM-DDTHH:MM:SS" as a local datetime string
  const localStr = `${date}T${time ?? '00:00'}:00`
  const utcDate = fromZonedTime(localStr, timezone)

  if (Number.isNaN(utcDate.getTime())) {
    // Invalid timezone — treat as UTC
    return new Date(`${localStr}Z`).toISOString()
  }

  return utcDate.toISOString()
}

/**
 * Convert a semantic schedule description to a 5-field cron expression.
 *
 * The time is expressed in the user's local timezone. The cron expression is
 * stored alongside the user's IANA timezone in the recurring_tasks table, and
 * cron.ts evaluates it in that timezone (via getLocalParts / Intl.DateTimeFormat).
 * No UTC conversion is applied here.
 */
export const semanticScheduleToCron = (schedule: SemanticSchedule): string => {
  const [hourStr, minuteStr] = schedule.time.split(':')
  const h = Number.parseInt(hourStr ?? '0', 10)
  const m = Number.parseInt(minuteStr ?? '0', 10)

  switch (schedule.frequency) {
    case 'daily':
      return `${m} ${h} * * *`
    case 'weekdays':
      return `${m} ${h} * * 1-5`
    case 'weekends':
      return `${m} ${h} * * 0,6`
    case 'weekly': {
      const days = schedule.days_of_week
      if (days === undefined || days.length === 0) return `${m} ${h} * * *`
      const dow = days.map((d) => DAY_OF_WEEK_MAP[d]).join(',')
      return `${m} ${h} * * ${dow}`
    }
    case 'monthly': {
      const dom = schedule.day_of_month ?? 1
      return `${m} ${h} ${dom} * *`
    }
  }
}

/**
 * Convert a UTC ISO string to a naive local datetime string ("YYYY-MM-DDTHH:MM:SS")
 * for display back to the LLM. No Z suffix — signals local time.
 *
 * Returns null/undefined unchanged. Falls back to the original string
 * when the input cannot be parsed.
 */
export const utcToLocal = (utcIso: string | null | undefined, timezone: string): string | null | undefined => {
  if (utcIso === null || utcIso === undefined) return utcIso
  try {
    return formatInTimeZone(new Date(utcIso), timezone, "yyyy-MM-dd'T'HH:mm:ss")
  } catch {
    return utcIso
  }
}
