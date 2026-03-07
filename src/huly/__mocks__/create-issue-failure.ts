/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

class MockFailingHulyClient {
  async findOne<T>(): Promise<T | undefined> {
    throw new Error('Project not found')
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupCreateIssueFailureMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockFailingHulyClient> => new MockFailingHulyClient(),
  }))
}
