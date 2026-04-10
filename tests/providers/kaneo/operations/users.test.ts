import { describe, expect, it, mock } from 'bun:test'
import { kaneoListUsers } from '../../../../src/providers/kaneo/operations/users.js'
import type { KaneoConfig } from '../../../../src/providers/kaneo/client.js'

const mockConfig: KaneoConfig = {
  baseUrl: 'http://localhost:3000',
  apiKey: 'test-key',
}

describe('kaneoListUsers', () => {
  it('should be defined', () => {
    expect(kaneoListUsers).toBeDefined()
    expect(typeof kaneoListUsers).toBe('function')
  })
})
