import { mock } from 'bun:test'

const mockProject = {
  _id: 'project-123',
  name: 'Original Project',
  identifier: 'PROJ',
  description: 'Original description',
}

class MockHulyClient {
  async findOne(_class: unknown, query: Record<string, unknown>): Promise<unknown | undefined> {
    const className = String(_class)
    const projectId = query['_id'] as string
    if (className.includes('Project') && projectId === 'project-123') {
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
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
