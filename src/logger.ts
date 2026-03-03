import pino from 'pino'

const getLogLevel = (): string => {
  const envLevel = process.env['LOG_LEVEL']?.toLowerCase()
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
  if (envLevel !== undefined && envLevel !== '' && validLevels.includes(envLevel)) {
    return envLevel
  }
  return 'info'
}

export const logger = pino({
  level: getLogLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: undefined,
})
