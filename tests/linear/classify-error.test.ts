import { describe, expect, test } from 'bun:test'

import { LinearApiError, classifyLinearError } from '../../src/linear/classify-error.js'

describe('LinearApiError', () => {
  test('extends Error with appError property', () => {
    const appError = { type: 'linear' as const, code: 'auth-failed' as const }
    const error = new LinearApiError('Auth failed', appError)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Auth failed')
    expect(error.appError).toBe(appError)
    expect(error.name).toBe('LinearApiError')
  })
})

describe('classifyLinearError not found cases', () => {
  test('classifies not found errors', () => {
    const error = classifyLinearError(new Error('Issue not found'))
    expect(error).toBeInstanceOf(LinearApiError)
    expect(error.appError.code).toBe('issue-not-found')
  })

  test('classifies resource not found errors', () => {
    const error = classifyLinearError(new Error('Resource not found'))
    expect(error.appError.code).toBe('issue-not-found')
  })
})

describe('classifyLinearError auth cases', () => {
  test('classifies authentication errors', () => {
    const error = classifyLinearError(new Error('Authentication failed'))
    expect(error.appError.code).toBe('auth-failed')
  })

  test('classifies unauthorized errors', () => {
    const error = classifyLinearError(new Error('Unauthorized'))
    expect(error.appError.code).toBe('auth-failed')
  })
})

describe('classifyLinearError rate limit cases', () => {
  test('classifies rate limit errors', () => {
    const error = classifyLinearError(new Error('Rate limit exceeded'))
    expect(error.appError.code).toBe('rate-limited')
  })

  test('classifies 429 status code', () => {
    const error = classifyLinearError(new Error('429 Too Many Requests'))
    expect(error.appError.code).toBe('rate-limited')
  })
})

describe('classifyLinearError validation cases', () => {
  test('classifies validation errors', () => {
    const error = classifyLinearError(new Error('Validation failed'))
    expect(error.appError.code).toBe('validation-failed')
  })

  test('classifies invalid input errors', () => {
    const error = classifyLinearError(new Error('Invalid field'))
    expect(error.appError.code).toBe('validation-failed')
  })
})

describe('classifyLinearError fallback cases', () => {
  test('wraps unknown errors as unexpected', () => {
    const original = new Error('Something else')
    const error = classifyLinearError(original)
    expect(error.appError.type).toBe('system')
    expect(error.appError.code).toBe('unexpected')
  })

  test('handles non-Error values', () => {
    const error = classifyLinearError('string error')
    expect(error).toBeInstanceOf(LinearApiError)
    expect(error.message).toBe('string error')
  })

  test('handles null/undefined', () => {
    const error = classifyLinearError(null)
    expect(error).toBeInstanceOf(LinearApiError)
    expect(error.message).toBe('null')
  })
})
