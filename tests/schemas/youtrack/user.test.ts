// tests/providers/youtrack/schemas/user.test.ts
import { describe, expect, test } from 'bun:test'

import { UserSchema, UserReferenceSchema } from '../../../schemas/youtrack/user.js'

describe('User schemas', () => {
  test('UserSchema validates full user', () => {
    const valid = {
      id: '1-1',
      $type: 'User',
      login: 'john.doe',
      fullName: 'John Doe',
      email: 'john@example.com',
      created: 1700000000000,
    }
    const result = UserSchema.parse(valid)
    expect(result.login).toBe('john.doe')
    expect(result.fullName).toBe('John Doe')
  })

  test('UserReferenceSchema validates reference', () => {
    const valid = {
      id: '1-1',
      $type: 'User',
      login: 'john.doe',
    }
    const result = UserReferenceSchema.parse(valid)
    expect(result.login).toBe('john.doe')
  })

  test('UserSchema requires login', () => {
    const invalid = {
      id: '1-1',
      $type: 'User',
    }
    expect(() => UserSchema.parse(invalid)).toThrow()
  })
})
