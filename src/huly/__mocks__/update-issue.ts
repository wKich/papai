import { mock } from 'bun:test'

const mockProject = {
  _id: 'project-123',
  identifier: 'P',
  defaultIssueStatus: 'status-1',
}

const mockIssue = {
  _id: 'issue-123',
  title: 'Test Issue',
  identifier: 'P-1',
  priority: 1,
  space: 'project-123',
  status: 'status-1',
  assignee: null,
  dueDate: null,
  estimation: 0,
}

const mockStatus = {
  _id: 'status-1',
  name: 'Todo',
}

const mockStatuses = [
  { _id: 'status-1', name: 'Todo' },
  { _id: 'status-2', name: 'In Progress' },
  { _id: 'status-3', name: 'Done' },
]

class MockHulyClient {
  async findOne(_class: unknown, query: Record<string, unknown>): Promise<unknown | undefined> {
    const className = String(_class)

    if (className.includes('Project')) {
      return mockProject
    }

    if (className.includes('Issue')) {
      const issueId = query['_id'] as string
      if (issueId === 'issue-123') {
        return mockIssue
      }
    }

    if (className.includes('IssueStatus')) {
      const name = query['name'] as string | undefined
      if (name !== undefined) {
        return mockStatuses.find((s) => s.name.toLowerCase() === name.toLowerCase())
      }
      return mockStatus
    }

    return undefined
  }

  async findAll(_class: unknown, query: Record<string, unknown>): Promise<unknown[]> {
    const className = String(_class)

    if (className.includes('TagReference')) {
      return []
    }

    if (className.includes('IssueStatus') && query['name']) {
      const name = query['name'] as string
      const found = mockStatuses.find((s) => s.name.toLowerCase() === name.toLowerCase())
      return found ? [found] : []
    }

    return []
  }

  async updateDoc(): Promise<unknown> {
    return { object: mockIssue }
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupUpdateIssueMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
