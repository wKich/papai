import { describe, it, expect } from 'bun:test'

import { classifyHulyError, HulyApiError } from '../../src/huly/classify-error.js'

describe('classifyHulyError', () => {
  it('should classify authentication errors', () => {
    const error = new Error('Authentication failed')
    const result = classifyHulyError(error)
    expect(result).toBeInstanceOf(HulyApiError)
    expect(result.appError.type).toBe('linear') // Keep type for compatibility
    expect(result.appError.code).toBe('auth-failed')
  })

  it('should classify not found errors', () => {
    const error = new Error('Document not found')
    const result = classifyHulyError(error)
    expect(result).toBeInstanceOf(HulyApiError)
    expect(result.appError.code).toBe('issue-not-found')
  })

  it('should classify validation errors', () => {
    const error = new Error('Invalid input')
    const result = classifyHulyError(error)
    expect(result).toBeInstanceOf(HulyApiError)
    expect(result.appError.code).toBe('validation-failed')
  })

  it('should wrap unknown errors', () => {
    const error = new Error('Something else')
    const result = classifyHulyError(error)
    expect(result).toBeInstanceOf(HulyApiError)
    expect(result.appError.type).toBe('system')
  })
})
