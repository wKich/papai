/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

const mockIssue = {
  _id: 'issue-123',
  title: 'Archived Issue',
  identifier: 'P-1',
}

const mockArchivedStatus = {
  _id: 'status-archived',
  name: 'Archived',
}

class MockHulyClient {
  async findOne(_class: unknown, query: Record<string, unknown>): Promise<unknown> {
    const className = String(_class)

    if (className.includes('Issue')) {
      const issueId = query['_id'] as string
      if (issueId === 'issue-123') {
        return mockIssue
      }
    }

    if (className.includes('IssueStatus')) {
      return mockArchivedStatus
    }

    return undefined
  }

  async updateDoc(): Promise<unknown> {
    return { object: mockIssue }
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupArchiveIssueMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
