import { mock } from 'bun:test'

class MockHulyClient {
  async findAll(_class: unknown): Promise<unknown[]> {
    return []
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupListProjectsEmptyMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
