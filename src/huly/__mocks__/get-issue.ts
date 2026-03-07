/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

const mockProject = {
  _id: 'project-123',
  identifier: 'P',
}

const mockIssue = {
  _id: 'issue-123',
  title: 'Test Issue',
  identifier: 'P-1',
  priority: 4, // Huly: 4 = Urgent, which maps to Linear: 1
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
      const issueId = query['_id'] as string
      if (issueId === 'issue-123') {
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
      const tagId = query['_id'] as string
      return mockTagElements.find((t) => t._id === tagId)
    }

    return undefined
  }

  async findAll(_class: unknown, query: Record<string, unknown>): Promise<unknown[]> {
    const className = String(_class)

    if (className.includes('TagReference')) {
      const attachedTo = query['attachedTo'] as string
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
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
