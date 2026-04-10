import { describe, expect, it } from 'bun:test'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { createKaneoIdentityResolver } from '../../../src/providers/kaneo/identity-resolver.js'

const mockConfig: KaneoConfig = {
  baseUrl: 'http://localhost:3000',
  apiKey: 'test-key',
}

const mockWorkspaceId = 'ws-123'

describe('createKaneoIdentityResolver', () => {
  it('should create a resolver with searchUsers method', () => {
    const resolver = createKaneoIdentityResolver(mockConfig, mockWorkspaceId)
    expect('searchUsers' in resolver).toBe(true)
    expect(typeof resolver.searchUsers).toBe('function')
  })
})
