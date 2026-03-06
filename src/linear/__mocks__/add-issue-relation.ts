import { mock } from 'bun:test'

import { IssueRelationType } from '@linear/sdk'

export { IssueRelationType }

export class MockLinearClient {
  createIssueRelation(): { issueRelation: Promise<{ id: string; type: string } | null> } {
    return {
      issueRelation: Promise.resolve({
        id: 'relation-123',
        type: 'blocks',
      }),
    }
  }
}

export function setupAddIssueRelationMock(): void {
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
