import { mock } from 'bun:test'

class MockHulyClient {
  async findAll(): Promise<unknown[]> {
    return []
  }

  async findOne(): Promise<unknown> {
    return undefined
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupSearchIssuesEmptyMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
