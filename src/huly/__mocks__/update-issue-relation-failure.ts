import { mock } from 'bun:test'

import type { PlatformClient } from '@hcengineering/api-client'
import tracker, { type Issue } from '@hcengineering/tracker'

// Mock storage for related issues
const mockIssues = new Map<string, Issue & { relatedIssues?: Array<{ issueId: string; type: string }> }>()

class MockHulyClient implements Partial<PlatformClient> {
  async findOne<T extends Record<string, unknown>>(
    _class: unknown,
    query: Record<string, unknown>,
  ): Promise<T | undefined> {
    const className = String(_class)

    if (className.includes('Issue')) {
      const issueId = query['_id'] as string

      if (issueId === 'issue-123') {
        // Return an issue with an existing relation (but not to 'invalid-issue')
        const existing = mockIssues.get(issueId)
        if (existing !== undefined) {
          return existing as unknown as T
        }
        const newIssue = {
          _id: 'issue-123' as unknown as Issue['_id'],
          _class: tracker.class.Issue,
          space: 'project-123' as unknown as Issue['space'],
          title: 'Test Issue',
          identifier: 'TEST-123',
          number: 1,
          priority: 0,
          status: 'status-1' as unknown as Issue['status'],
          assignee: null,
          component: null,
          estimation: 0,
          remainingTime: 0,
          reportedTime: 0,
          reports: 0,
          subIssues: 0,
          parents: [],
          childInfo: [],
          dueDate: null,
          rank: '0',
          modifiedOn: Date.now(),
          modifiedBy: 'system' as unknown as Issue['modifiedBy'],
          createdBy: 'system' as unknown as Issue['createdBy'],
          createdOn: Date.now(),
          relatedIssues: [{ issueId: 'issue-456', type: 'blocks' }],
        } as unknown as Issue
        mockIssues.set(issueId, newIssue)
        return newIssue as unknown as T
      }

      return mockIssues.get(issueId) as unknown as T
    }

    return undefined
  }

  async close(): Promise<void> {
    mockIssues.clear()
  }
}

export function setupUpdateIssueRelationFailureMock(): void {
  mockIssues.clear()
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
