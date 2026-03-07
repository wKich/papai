/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
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
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
