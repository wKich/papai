import { describe, expect, test } from 'bun:test'

import { logger } from '../src/logger.js'

describe('logger', () => {
  describe('logger methods', () => {
    test('has all required log methods', () => {
      expect(typeof logger.trace).toBe('function')
      expect(typeof logger.debug).toBe('function')
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
      expect(typeof logger.fatal).toBe('function')
    })
  })

  describe('logger properties', () => {
    test('has a level property', () => {
      expect(typeof logger.level).toBe('string')
    })

    test('level is one of the valid pino levels', () => {
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
      expect(validLevels).toContain(logger.level)
    })
  })
})
