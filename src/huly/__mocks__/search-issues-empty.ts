import { mock } from 'bun:test'

class MockHulyClient {
  async findAll(): Promise<unknown[]> {
    return []
  }

  async findOne(): Promise<unknown | undefined> {
    return undefined
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupSearchIssuesEmptyMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
