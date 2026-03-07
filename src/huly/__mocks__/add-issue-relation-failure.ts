/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

import type { PlatformClient } from '@hcengineering/api-client'

class MockHulyClient implements Partial<PlatformClient> {
  async findOne<T extends Record<string, unknown>>(
    _class: unknown,
    query: Record<string, unknown>,
  ): Promise<T | undefined> {
    const className = String(_class)

    if (className.includes('Issue')) {
      const issueId = query['_id'] as string

      if (issueId === 'invalid-issue') {
        return undefined
      }
    }

    return undefined
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupAddIssueRelationFailureMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
