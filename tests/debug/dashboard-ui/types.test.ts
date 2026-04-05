import { describe, expect, test } from 'bun:test'

import type { SessionDetail } from '../../../src/debug/dashboard-ui/types.js'

describe('dashboard-ui types', () => {
  test('SessionDetail type accepts all required fields', () => {
    const session: SessionDetail = {
      userId: 'test-user',
      lastAccessed: Date.now(),
      historyLength: 5,
      factsCount: 2,
      summary: 'Test summary',
      configKeys: ['key1', 'key2'],
      workspaceId: 'ws-1',
      hasTools: true,
      instructionsCount: 3,
      facts: [{ identifier: 'fact-1', title: 'Fact 1', url: 'http://example.com', lastSeen: '2024-01-01' }],
      config: { key1: 'value1' },
      instructions: [{ id: 'inst-1', text: 'Be helpful', createdAt: '2024-01-01' }],
      history: [{ role: 'user', content: 'Hello' }],
    }

    expect(session.userId).toBe('test-user')
    expect(session.historyLength).toBe(5)
  })
})
