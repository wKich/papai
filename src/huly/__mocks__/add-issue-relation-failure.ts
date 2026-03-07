import { mock } from 'bun:test'

class MockHulyClient {
  async findOne(_class: unknown, query: Record<string, unknown>): Promise<unknown> {
    const className = String(_class)

    if (className.includes('Issue') && query['_id'] === 'invalid-issue') {
      return undefined
    }

    return undefined
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupAddIssueRelationFailureMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
