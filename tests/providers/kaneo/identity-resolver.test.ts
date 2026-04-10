import { describe, expect, it } from 'bun:test'
import { createKaneoIdentityResolver } from '../../../src/providers/kaneo/identity-resolver.js'
import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'

const mockConfig: KaneoConfig = {
  baseUrl: 'http://localhost:3000',
  apiKey: 'test-key',
  workspaceId: 'ws-123',
}

describe('createKaneoIdentityResolver', () => {
  it('should create a resolver with searchUsers method', () => {
    const resolver = createKaneoIdentityResolver(mockConfig)
    expect(resolver.searchUsers).toBeDefined()
    expect(typeof resolver.searchUsers).toBe('function')
  })
})
