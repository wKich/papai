import { mock } from 'bun:test'

const mockProject = {
  _id: 'project-123',
  identifier: 'P',
}

const mockIssue = {
  _id: 'issue-123',
  title: 'Test Issue',
  identifier: 'P-1',
  // Huly: 4 = Urgent, which maps to priority: 1 in external API convention
  priority: 4,
  space: 'project-123',
  description: { content: [] },
  status: 'status-1',
  assignee: 'user-1',
  dueDate: new Date('2025-03-15').getTime(),
  estimation: 5,
}

const mockStatus = {
  _id: 'status-1',
  name: 'In Progress',
}

const mockAssignee = {
  _id: 'user-1',
  name: 'John Doe',
}

const mockLabels = [
  {
    _id: 'label-ref-1',
    attachedTo: 'issue-123',
    tag: 'label-1',
  },
  {
    _id: 'label-ref-2',
    attachedTo: 'issue-123',
    tag: 'label-2',
  },
]

const mockTagElements = [
  {
    _id: 'label-1',
    title: 'Bug',
    color: 0xff0000,
  },
  {
    _id: 'label-2',
    title: 'Feature',
    color: 0x00ff00,
  },
]

class MockHulyClient {
  async findOne(_class: unknown, query: Record<string, unknown>): Promise<unknown> {
    const className = String(_class)

    if (className.includes('Project')) {
      return mockProject
    }

    if (className.includes('Issue')) {
      const rawId = query['_id']
      if (rawId === 'issue-123') {
        return mockIssue
      }
    }

    if (className.includes('IssueStatus')) {
      return mockStatus
    }

    if (className.includes('Person')) {
      return mockAssignee
    }

    if (className.includes('TagElement')) {
      const rawTagId = query['_id']
      return typeof rawTagId === 'string' ? mockTagElements.find((t) => t._id === rawTagId) : undefined
    }

    return undefined
  }

  async findAll(_class: unknown, query: Record<string, unknown>): Promise<unknown[]> {
    const className = String(_class)

    if (className.includes('TagReference')) {
      const attachedTo = query['attachedTo']
      if (attachedTo === 'issue-123') {
        return mockLabels
      }
    }

    return []
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupGetIssueMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
