import { mock } from 'bun:test'

import { IssueRelationType } from '@linear/sdk'

export { IssueRelationType }

export class MockLinearClient {
  issue(): Promise<{
    id: string
    relations: () => Promise<{
      nodes: Array<{ id: string; relatedIssue: Promise<{ id: string } | null>; type: string }>
    }>
  }> {
    return Promise.resolve({
      id: 'issue-123',
      relations: () =>
        Promise.resolve({
          nodes: [
            {
              id: 'relation-123',
              relatedIssue: Promise.resolve({ id: 'issue-456' }),
              type: 'blocks',
            },
          ],
        }),
    })
  }

  updateIssueRelation(): { issueRelation: Promise<{ id: string; type: string }> } {
    return {
      issueRelation: Promise.resolve({
        id: 'relation-123',
        type: 'related',
      }),
    }
  }
}

export function setupUpdateIssueRelationMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
    IssueRelationType,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
