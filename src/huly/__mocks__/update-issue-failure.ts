/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

class MockHulyClient {
  async findOne(): Promise<unknown> {
    throw new Error('Unauthorized')
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupUpdateIssueFailureMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
