import { describe, expect, it } from 'bun:test'

import {
  extractIdentityClaim,
  extractIdentityDenial,
  isIdentityClaim,
  isIdentityDenial,
} from '../../src/identity/nl-detection.js'

describe('identity claim detection', () => {
  it('should detect "I\'m jsmith" pattern', () => {
    const result = extractIdentityClaim("I'm jsmith")
    expect(result).toBe('jsmith')
  })

  it('should detect "I am jsmith" pattern', () => {
    const result = extractIdentityClaim('I am jsmith')
    expect(result).toBe('jsmith')
  })

  it('should detect "My login is jsmith" pattern', () => {
    const result = extractIdentityClaim('My login is jsmith')
    expect(result).toBe('jsmith')
  })

  it('should detect "Link me to user jsmith" pattern', () => {
    const result = extractIdentityClaim('Link me to user jsmith')
    expect(result).toBe('jsmith')
  })

  it('should detect "I\'m not Alice, I\'m jsmith" pattern', () => {
    const result = extractIdentityClaim("I'm not Alice, I'm jsmith")
    expect(result).toBe('jsmith')
  })

  it('should return null for non-claim messages', () => {
    const result = extractIdentityClaim('Show my tasks')
    expect(result).toBeNull()
  })

  it('should detect identity claim via isIdentityClaim', () => {
    expect(isIdentityClaim("I'm jsmith")).toBe(true)
    expect(isIdentityClaim('Show my tasks')).toBe(false)
  })
})

describe('identity denial detection', () => {
  it('should detect "I\'m not Alice" pattern', () => {
    const result = extractIdentityDenial("I'm not Alice")
    expect(result).toBe(true)
  })

  it('should detect "That\'s not me" pattern', () => {
    const result = extractIdentityDenial("That's not me")
    expect(result).toBe(true)
  })

  it('should detect "These aren\'t my tasks" pattern', () => {
    const result = extractIdentityDenial("These aren't my tasks")
    expect(result).toBe(true)
  })

  it('should detect "Unlink my account" pattern', () => {
    const result = extractIdentityDenial('Unlink my account')
    expect(result).toBe(true)
  })

  it('should return false for non-denial messages', () => {
    const result = extractIdentityDenial('Show my tasks')
    expect(result).toBe(false)
  })

  it('should detect identity denial via isIdentityDenial', () => {
    expect(isIdentityDenial("I'm not Alice")).toBe(true)
    expect(isIdentityDenial('Show my tasks')).toBe(false)
  })
})
