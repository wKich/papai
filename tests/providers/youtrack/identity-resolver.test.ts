import { describe, expect, it } from 'bun:test'

import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import { createYouTrackIdentityResolver } from '../../../src/providers/youtrack/identity-resolver.js'

const mockConfig: YouTrackConfig = {
  baseUrl: 'http://localhost:8080',
  token: 'test-token',
}

describe('createYouTrackIdentityResolver', () => {
  it('should create a resolver with searchUsers method', () => {
    const resolver = createYouTrackIdentityResolver(mockConfig)
    expect('searchUsers' in resolver).toBe(true)
    expect(typeof resolver.searchUsers).toBe('function')
  })

  it('should create a resolver with getUserByLogin method', () => {
    const resolver = createYouTrackIdentityResolver(mockConfig)
    expect('getUserByLogin' in resolver).toBe(true)
    expect(typeof resolver.getUserByLogin).toBe('function')
  })
})
