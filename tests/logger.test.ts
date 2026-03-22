import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getLogLevel } from '../src/logger.js'

describe('getLogLevel', () => {
  let originalLogLevel: string | undefined

  beforeEach(() => {
    originalLogLevel = process.env['LOG_LEVEL']
  })

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env['LOG_LEVEL']
    } else {
      process.env['LOG_LEVEL'] = originalLogLevel
    }
  })

  test('LOG_LEVEL=debug returns debug', () => {
    process.env['LOG_LEVEL'] = 'debug'
    expect(getLogLevel()).toBe('debug')
  })

  test('LOG_LEVEL=DEBUG is case-insensitive', () => {
    process.env['LOG_LEVEL'] = 'DEBUG'
    expect(getLogLevel()).toBe('debug')
  })

  test('LOG_LEVEL=trace returns trace', () => {
    process.env['LOG_LEVEL'] = 'trace'
    expect(getLogLevel()).toBe('trace')
  })

  test('LOG_LEVEL=info returns info', () => {
    process.env['LOG_LEVEL'] = 'info'
    expect(getLogLevel()).toBe('info')
  })

  test('LOG_LEVEL=warn returns warn', () => {
    process.env['LOG_LEVEL'] = 'warn'
    expect(getLogLevel()).toBe('warn')
  })

  test('LOG_LEVEL=error returns error', () => {
    process.env['LOG_LEVEL'] = 'error'
    expect(getLogLevel()).toBe('error')
  })

  test('LOG_LEVEL=fatal returns fatal', () => {
    process.env['LOG_LEVEL'] = 'fatal'
    expect(getLogLevel()).toBe('fatal')
  })

  test('LOG_LEVEL=silent returns silent', () => {
    process.env['LOG_LEVEL'] = 'silent'
    expect(getLogLevel()).toBe('silent')
  })

  test('LOG_LEVEL=banana falls back to info', () => {
    process.env['LOG_LEVEL'] = 'banana'
    expect(getLogLevel()).toBe('info')
  })

  test('LOG_LEVEL="" falls back to info', () => {
    process.env['LOG_LEVEL'] = ''
    expect(getLogLevel()).toBe('info')
  })

  test('LOG_LEVEL unset falls back to info', () => {
    delete process.env['LOG_LEVEL']
    expect(getLogLevel()).toBe('info')
  })
})
