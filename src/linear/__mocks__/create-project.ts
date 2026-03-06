import { mock } from 'bun:test'

class MockHulyClient {
  async createDoc(_class: unknown, _space: unknown, data: Record<string, unknown>, id: string): Promise<void> {
    // Project created
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupCreateProjectMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
