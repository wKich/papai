import { describe, expect, it } from 'bun:test'

import { kaneoListUsers } from '../../../../src/providers/kaneo/operations/users.js'

describe('kaneoListUsers', () => {
  it('should be defined', () => {
    expect(kaneoListUsers).toBeDefined()
    expect(typeof kaneoListUsers).toBe('function')
  })
})
