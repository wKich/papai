import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-current-time' })

const getLocalDateString = (timezone: string): string => {
  try {
    return new Date().toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
}

export function makeGetCurrentTimeTool(userId?: string): ToolSet[string] {
  return tool({
    description:
      'Get the current date and time. Use this tool to answer questions about the current date, time, or to determine relative dates like "tomorrow" or "next Monday".',
    inputSchema: z.object({}),
    execute: () => {
      const timezone = userId === undefined ? 'UTC' : (getConfig(userId, 'timezone') ?? 'UTC')
      const now = new Date()
      const localFormatted = getLocalDateString(timezone)

      log.info({ timezone }, 'Current time fetched')

      return Promise.resolve({
        datetime: now.toISOString(),
        timezone,
        localFormatted,
      })
    },
  })
}
