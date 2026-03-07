import { mock } from 'bun:test'

const mockProject = {
  _id: 'project-123',
  name: 'Original Project',
  identifier: 'PROJ',
  description: 'Original description',
}

class MockHulyClient {
  async findOne(_class: unknown, query: Record<string, unknown>): Promise<unknown> {
    const className = String(_class)
    if (className.includes('Project') && query['_id'] === 'project-123') {
      return mockProject
    }
    return undefined
  }

  async updateDoc(_class: unknown, _space: unknown, _id: unknown, _updates: Record<string, unknown>): Promise<void> {
    // Project updated
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupUpdateProjectMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
