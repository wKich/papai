import { describe, expect, test } from 'bun:test'

import { hulyError, llmError, validationError, systemError, isAppError, getUserMessage } from '../src/errors.js'

describe('hulyError basic constructors', () => {
  test('issueNotFound creates correct structure', () => {
    const error = hulyError.issueNotFound('ISS-123')
    expect(error).toEqual({
      type: 'huly',
      code: 'issue-not-found',
      issueId: 'ISS-123',
    })
  })

  test('teamNotFound creates correct structure', () => {
    const error = hulyError.teamNotFound('TEAM-456')
    expect(error).toEqual({
      type: 'huly',
      code: 'team-not-found',
      teamId: 'TEAM-456',
    })
  })

  test('authFailed creates correct structure', () => {
    const error = hulyError.authFailed()
    expect(error).toEqual({
      type: 'huly',
      code: 'auth-failed',
    })
  })

  test('rateLimited creates correct structure', () => {
    const error = hulyError.rateLimited()
    expect(error).toEqual({
      type: 'huly',
      code: 'rate-limited',
    })
  })
})

describe('hulyError advanced constructors', () => {
  test('validationFailed creates correct structure', () => {
    const error = hulyError.validationFailed('title', 'Title is required')
    expect(error).toEqual({
      type: 'huly',
      code: 'validation-failed',
      field: 'title',
      reason: 'Title is required',
    })
  })

  test('labelNotFound creates correct structure', () => {
    const error = hulyError.labelNotFound('urgent')
    expect(error).toEqual({
      type: 'huly',
      code: 'label-not-found',
      labelName: 'urgent',
    })
  })

  test('unknown creates correct structure', () => {
    const originalError = new Error('Something went wrong')
    const error = hulyError.unknown(originalError)
    expect(error.type).toBe('huly')
    expect(error.code).toBe('unknown')
    if (error.code === 'unknown') {
      expect(error.originalError).toBe(originalError)
    }
  })
})

describe('llmError constructors', () => {
  test('apiError creates correct structure', () => {
    const error = llmError.apiError('Connection timeout')
    expect(error).toEqual({
      type: 'llm',
      code: 'api-error',
      message: 'Connection timeout',
    })
  })

  test('rateLimited creates correct structure', () => {
    const error = llmError.rateLimited()
    expect(error).toEqual({ type: 'llm', code: 'rate-limited' })
  })

  test('timeout creates correct structure', () => {
    const error = llmError.timeout()
    expect(error).toEqual({ type: 'llm', code: 'timeout' })
  })

  test('tokenLimit creates correct structure', () => {
    const error = llmError.tokenLimit()
    expect(error).toEqual({ type: 'llm', code: 'token-limit' })
  })
})

describe('validationError constructors', () => {
  test('invalidInput creates correct structure', () => {
    const error = validationError.invalidInput('email', 'Invalid format')
    expect(error).toEqual({
      type: 'validation',
      code: 'invalid-input',
      field: 'email',
      reason: 'Invalid format',
    })
  })

  test('missingRequired creates correct structure', () => {
    const error = validationError.missingRequired('api_key')
    expect(error).toEqual({
      type: 'validation',
      code: 'missing-required',
      field: 'api_key',
    })
  })
})

describe('systemError constructors', () => {
  test('configMissing creates correct structure', () => {
    const error = systemError.configMissing('LINEAR_API_KEY')
    expect(error).toEqual({
      type: 'system',
      code: 'config-missing',
      variable: 'LINEAR_API_KEY',
    })
  })

  test('networkError creates correct structure', () => {
    const error = systemError.networkError('Connection refused')
    expect(error).toEqual({
      type: 'system',
      code: 'network-error',
      message: 'Connection refused',
    })
  })

  test('unexpected creates correct structure', () => {
    const originalError = new Error('Unexpected failure')
    const error = systemError.unexpected(originalError)
    expect(error.type).toBe('system')
    expect(error.code).toBe('unexpected')
    if (error.code === 'unexpected') {
      expect(error.originalError).toBe(originalError)
    }
  })
})

describe('isAppError type guard', () => {
  test('returns true for all valid error types', () => {
    expect(isAppError(hulyError.authFailed())).toBe(true)
    expect(isAppError(llmError.timeout())).toBe(true)
    expect(isAppError(validationError.missingRequired('field'))).toBe(true)
    expect(isAppError(systemError.configMissing('VAR'))).toBe(true)
  })

  test('returns false for non-AppError values', () => {
    expect(isAppError(new Error('test'))).toBe(false)
    expect(isAppError(null)).toBe(false)
    expect(isAppError(undefined)).toBe(false)
    expect(isAppError('error')).toBe(false)
    expect(isAppError(42)).toBe(false)
    expect(isAppError({})).toBe(false)
    expect(isAppError({ code: 'error' })).toBe(false)
    expect(isAppError({ type: 'invalid' })).toBe(false)
  })
})

describe('getUserMessage for huly errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(hulyError.issueNotFound('ABC-123'))).toContain('ABC-123')
    expect(getUserMessage(hulyError.teamNotFound('TEAM-1'))).toContain('Team configuration')
    expect(getUserMessage(hulyError.authFailed())).toContain('Failed to connect')
    expect(getUserMessage(hulyError.rateLimited())).toContain('rate limit')
    expect(getUserMessage(hulyError.validationFailed('title', 'too short'))).toContain('title')
    expect(getUserMessage(hulyError.labelNotFound('bug'))).toContain('bug')
    expect(getUserMessage(hulyError.unknown(new Error('test')))).toContain('error occurred')
  })
})

describe('getUserMessage for llm errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(llmError.apiError('timeout'))).toContain('timeout')
    expect(getUserMessage(llmError.rateLimited())).toContain('rate limit')
    expect(getUserMessage(llmError.timeout())).toContain('timed out')
    expect(getUserMessage(llmError.tokenLimit())).toContain('too long')
  })
})

describe('getUserMessage for validation errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(validationError.invalidInput('email', 'bad'))).toContain('email')
    expect(getUserMessage(validationError.missingRequired('name'))).toContain('name')
  })
})

describe('getUserMessage for system errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(systemError.configMissing('API_KEY'))).toContain('API_KEY')
    expect(getUserMessage(systemError.networkError('timeout'))).toContain('timeout')
    expect(getUserMessage(systemError.unexpected(new Error('oops')))).toContain('unexpected')
  })
})
