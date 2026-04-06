import { describe, expect, it } from 'bun:test'

import { str, num, bool, isTokenRecord, tokenUsage } from '../../src/debug/state-collector-utils.js'

describe('state-collector-utils', () => {
  describe('str', () => {
    it('should return string value as-is', () => {
      expect(str('hello')).toBe('hello')
    })

    it('should return empty string for non-string values', () => {
      expect(str(123)).toBe('')
      expect(str(null)).toBe('')
      expect(str(undefined)).toBe('')
      expect(str({})).toBe('')
    })
  })

  describe('num', () => {
    it('should return number value as-is', () => {
      expect(num(42)).toBe(42)
    })

    it('should return 0 for non-number values', () => {
      expect(num('123')).toBe(0)
      expect(num(null)).toBe(0)
      expect(num(undefined)).toBe(0)
    })
  })

  describe('bool', () => {
    it('should return boolean value as-is', () => {
      expect(bool(true)).toBe(true)
      expect(bool(false)).toBe(false)
    })

    it('should return false for non-boolean values', () => {
      expect(bool('true')).toBe(false)
      expect(bool(1)).toBe(false)
      expect(bool(null)).toBe(false)
    })
  })

  describe('isTokenRecord', () => {
    it('should return true for token record objects', () => {
      expect(isTokenRecord({ inputTokens: 10, outputTokens: 20 })).toBe(true)
    })

    it('should return false for non-objects or missing properties', () => {
      expect(isTokenRecord(null)).toBe(false)
      expect(isTokenRecord({ inputTokens: 10 })).toBe(false)
      expect(isTokenRecord('string')).toBe(false)
    })
  })

  describe('tokenUsage', () => {
    it('should extract token usage from valid record', () => {
      const result = tokenUsage({ inputTokens: 10, outputTokens: 20 })
      expect(result).toEqual({ inputTokens: 10, outputTokens: 20 })
    })

    it('should return zeros for invalid input', () => {
      expect(tokenUsage(null)).toEqual({ inputTokens: 0, outputTokens: 0 })
      expect(tokenUsage({})).toEqual({ inputTokens: 0, outputTokens: 0 })
    })
  })
})
