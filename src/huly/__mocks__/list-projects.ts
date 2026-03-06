import { mock } from 'bun:test'

const mockProjects = [
  {
    _id: 'proj-1',
    name: 'Project A',
    identifier: 'PROJ-A',
    description: 'Description for Project A',
  },
  {
    _id: 'proj-2',
    name: 'Project B',
    identifier: 'PROJ-B',
    description: 'Description for Project B',
  },
]

class MockHulyClient {
  async findAll(_class: unknown): Promise<unknown[]> {
    const className = String(_class)
    if (className.includes('Project')) {
      return mockProjects
    }
    return []
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupListProjectsMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
