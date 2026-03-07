import { mock } from 'bun:test'

class MockHulyClient {
  async createDoc(_class: unknown, _space: unknown, _data: Record<string, unknown>, _id: string): Promise<void> {
    // Project created
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupCreateProjectMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
