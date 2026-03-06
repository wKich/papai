import { mock } from 'bun:test'

class MockHulyClient {
  async findOne(): Promise<unknown | undefined> {
    throw new Error('Unauthorized')
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupUpdateIssueFailureMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
