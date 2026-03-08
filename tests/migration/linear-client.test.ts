import { describe, it, expect } from 'bun:test'

import { createLinearClient, fetchUserIssues } from '../../src/migration/linear-client.js'

describe('Linear Client', () => {
  it('should create client with API key', () => {
    const client = createLinearClient('test-api-key')
    expect(client).toBeDefined()
  })

  it('should have fetchUserIssues function', () => {
    expect(typeof fetchUserIssues).toBe('function')
  })
})
