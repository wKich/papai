import { mock } from 'bun:test'

// Mock storage
const mockIssues = new Map([
  [
    'issue-1',
    {
      _id: 'issue-1',
      title: 'First issue',
      identifier: 'P-1',
      priority: 0,
      space: 'project-123',
    },
  ],
  [
    'issue-2',
    {
      _id: 'issue-2',
      title: 'Second issue',
      identifier: 'P-2',
      priority: 1,
      space: 'project-123',
    },
  ],
])

const mockProject = {
  _id: 'project-123',
  identifier: 'P',
}

class MockHulyClient {
  async findAll(_class: unknown, query: Record<string, unknown>): Promise<unknown[]> {
    const className = String(_class)

    if (className.includes('Issue')) {
      const titleFilter = query['title']
      if (typeof titleFilter === 'object' && titleFilter !== null && '$like' in titleFilter) {
        const likeValue = titleFilter['$like']
        if (typeof likeValue === 'string') {
          const searchTerm = likeValue.replace(/%/g, '').toLowerCase()
          return Array.from(mockIssues.values()).filter((issue) => issue.title.toLowerCase().includes(searchTerm))
        }
      }
      return Array.from(mockIssues.values())
    }

    return []
  }

  async findOne(_class: unknown, query: Record<string, unknown>): Promise<unknown> {
    const className = String(_class)

    if (className.includes('Project')) {
      return mockProject
    }

    if (className.includes('Issue')) {
      const rawId = query['_id']
      return typeof rawId === 'string' ? mockIssues.get(rawId) : undefined
    }

    return undefined
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupSearchIssuesMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
