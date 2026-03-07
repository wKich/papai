import { mock } from 'bun:test'

type MockIssue = Record<string, unknown>

const mockIssues = new Map<string, MockIssue>()

function makeIssue123(): MockIssue {
  return {
    _id: 'issue-123',
    title: 'Test Issue',
    identifier: 'TEST-123',
    priority: 0,
    space: 'project-123',
    status: 'status-1',
    relatedIssues: [],
  }
}

function makeIssue456(): MockIssue {
  return {
    _id: 'issue-456',
    title: 'Related Issue',
    identifier: 'TEST-456',
    priority: 0,
    space: 'project-123',
    status: 'status-1',
  }
}

class MockHulyClient {
  async updateDoc(_class: unknown, _space: unknown, id: unknown, attributes: MockIssue): Promise<void> {
    const className = String(_class)
    const issueId = typeof id === 'string' ? id : ''

    if (className.includes('Issue') && issueId !== '' && attributes['relatedIssues'] !== undefined) {
      const existing = mockIssues.get(issueId)
      if (existing !== undefined) {
        mockIssues.set(issueId, { ...existing, relatedIssues: attributes['relatedIssues'] })
      }
    }
  }

  async findOne(_class: unknown, query: MockIssue): Promise<unknown> {
    const className = String(_class)

    if (className.includes('Issue')) {
      const issueId = query['_id']

      if (issueId === 'issue-123') {
        const existing = mockIssues.get('issue-123')
        if (existing !== undefined) return existing
        const newIssue = makeIssue123()
        mockIssues.set('issue-123', newIssue)
        return newIssue
      }

      if (issueId === 'issue-456') {
        return makeIssue456()
      }

      return typeof issueId === 'string' ? mockIssues.get(issueId) : undefined
    }

    return undefined
  }

  async close(): Promise<void> {
    mockIssues.clear()
  }
}

export function setupAddIssueRelationMock(): void {
  mockIssues.clear()
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
