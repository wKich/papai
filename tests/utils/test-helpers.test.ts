import { describe, expect, test } from 'bun:test'

import { getUserMessage, webFetchError } from '../../src/errors.js'
import { expectAppError } from './test-helpers.js'

describe('expectAppError', () => {
  test('accepts classified errors that carry an AppError in appError', () => {
    const error = Object.assign(new Error('Invalid URL'), {
      appError: webFetchError.invalidUrl(),
      type: 'web-fetch' as const,
      code: 'invalid-url' as const,
    })

    expect(() => expectAppError(error, getUserMessage(webFetchError.invalidUrl()))).not.toThrow()
  })
})
