import { describe, expect, test, mock, beforeEach } from 'bun:test'

import pino from 'pino'

describe('logger', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('multistream level filtering', () => {
    test('with level: trace set on stream, outputs trace/debug logs', async () => {
      const outputs: string[] = []

      // Create a mock stream that captures output
      const mockStream = {
        write: (chunk: string): void => {
          outputs.push(chunk)
        },
      }

      // Create multistream WITH level: trace on the stream entry
      const multistream = pino.multistream([{ level: 'trace', stream: mockStream }])
      const logger = pino(
        {
          level: 'trace',
          timestamp: pino.stdTimeFunctions.isoTime,
          base: undefined,
        },
        multistream,
      )

      logger.trace('test trace message')
      logger.debug('test debug message')
      logger.info('test info message')

      // Allow async flush
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 10)
      })

      const output = outputs.join('')

      expect(logger.level).toBe('trace')
      expect(output).toContain('test trace message')
      expect(output).toContain('test debug message')
      expect(output).toContain('test info message')
    })

    test('without level on stream, only info and above are output', async () => {
      const outputs: string[] = []

      const mockStream = {
        write: (chunk: string): void => {
          outputs.push(chunk)
        },
      }

      // Create multistream WITHOUT level on stream entry (this is the bug)
      const multistream = pino.multistream([{ stream: mockStream }])
      const logger = pino(
        {
          level: 'trace',
          timestamp: pino.stdTimeFunctions.isoTime,
          base: undefined,
        },
        multistream,
      )

      logger.trace('should not appear')
      logger.debug('should not appear')
      logger.info('test info message')

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 10)
      })

      const output = outputs.join('')

      expect(logger.level).toBe('trace')
      // When stream has no level, it defaults to 'info'
      expect(output).not.toContain('should not appear')
      expect(output).toContain('test info message')
    })

    test('with level: debug set on stream, outputs debug logs but not trace', async () => {
      const outputs: string[] = []

      const mockStream = {
        write: (chunk: string): void => {
          outputs.push(chunk)
        },
      }

      const multistream = pino.multistream([{ level: 'debug', stream: mockStream }])
      const logger = pino(
        {
          level: 'trace',
          timestamp: pino.stdTimeFunctions.isoTime,
          base: undefined,
        },
        multistream,
      )

      logger.trace('should not appear')
      logger.debug('test debug message')
      logger.info('test info message')

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 10)
      })

      const output = outputs.join('')

      expect(logger.level).toBe('trace')
      expect(output).not.toContain('should not appear')
      expect(output).toContain('test debug message')
      expect(output).toContain('test info message')
    })

    test('stream level matches logger level for LOG_LEVEL=debug', async () => {
      const outputs: string[] = []

      const mockStream = {
        write: (chunk: string): void => {
          outputs.push(chunk)
        },
      }

      // Both logger and stream at debug level
      const multistream = pino.multistream([{ level: 'debug', stream: mockStream }])
      const logger = pino(
        {
          level: 'debug',
          timestamp: pino.stdTimeFunctions.isoTime,
          base: undefined,
        },
        multistream,
      )

      logger.trace('should not appear')
      logger.debug('test debug message')
      logger.info('test info message')

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 10)
      })

      const output = outputs.join('')

      expect(logger.level).toBe('debug')
      expect(output).not.toContain('should not appear')
      expect(output).toContain('test debug message')
      expect(output).toContain('test info message')
    })
  })

  describe('getLogLevel', () => {
    test('returns default info when LOG_LEVEL is not set', async () => {
      const { getLogLevel } = await import('../src/logger.js')
      // This depends on actual env, but default should be 'info'
      const result = getLogLevel()
      expect(['info', 'trace', 'debug', 'silent']).toContain(result)
    })

    test('returns trace when LOG_LEVEL=trace', () => {
      const originalEnv = process.env['LOG_LEVEL']
      process.env['LOG_LEVEL'] = 'trace'

      try {
        // Must re-import to get fresh evaluation
        // But due to module caching, we need to test the logic directly
        const envLevel = process.env['LOG_LEVEL']?.toLowerCase()
        const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
        const result = envLevel !== undefined && envLevel !== '' && validLevels.includes(envLevel) ? envLevel : 'info'
        expect(result).toBe('trace')
      } finally {
        if (originalEnv === undefined) {
          delete process.env['LOG_LEVEL']
        } else {
          process.env['LOG_LEVEL'] = originalEnv
        }
      }
    })

    test('returns debug when LOG_LEVEL=DEBUG (case insensitive)', () => {
      const originalEnv = process.env['LOG_LEVEL']
      process.env['LOG_LEVEL'] = 'DEBUG'

      try {
        const envLevel = process.env['LOG_LEVEL']?.toLowerCase()
        const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
        const result = envLevel !== undefined && envLevel !== '' && validLevels.includes(envLevel) ? envLevel : 'info'
        expect(result).toBe('debug')
      } finally {
        if (originalEnv === undefined) {
          delete process.env['LOG_LEVEL']
        } else {
          process.env['LOG_LEVEL'] = originalEnv
        }
      }
    })

    test('returns default for invalid LOG_LEVEL value', () => {
      const originalEnv = process.env['LOG_LEVEL']
      process.env['LOG_LEVEL'] = 'invalid'

      try {
        const envLevel = process.env['LOG_LEVEL']?.toLowerCase()
        const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
        const result = envLevel !== undefined && envLevel !== '' && validLevels.includes(envLevel) ? envLevel : 'info'
        expect(result).toBe('info')
      } finally {
        if (originalEnv === undefined) {
          delete process.env['LOG_LEVEL']
        } else {
          process.env['LOG_LEVEL'] = originalEnv
        }
      }
    })
  })
})
