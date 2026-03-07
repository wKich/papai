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

  async removeDoc(_class: unknown, _space: unknown, _id: unknown): Promise<void> {
    // Project removed/archived
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupArchiveProjectMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
