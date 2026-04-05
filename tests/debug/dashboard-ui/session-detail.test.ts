import { describe, expect, test } from 'bun:test'

import type { SessionDetail } from '../../../src/debug/dashboard-ui/types.js'

describe('session-detail', () => {
  test('SessionDetail type is properly exported', () => {
    const session: SessionDetail = {
      userId: 'test-user',
      lastAccessed: Date.now(),
      historyLength: 5,
      factsCount: 2,
      summary: null,
      configKeys: [],
      workspaceId: null,
    }

    expect(session.userId).toBe('test-user')
    expect(session.historyLength).toBe(5)
  })
})
