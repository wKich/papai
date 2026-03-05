import { mock } from 'bun:test'

export interface IssueRelationNode {
  id: string
  type: string
  relatedIssue: Promise<{ id: string; identifier: string } | null>
}

export class MockLinearClient {
  issue(): Promise<{
    relations: () => Promise<{ nodes: (IssueRelationNode | null)[] }>
  }> {
    return Promise.resolve({
      relations: () =>
        Promise.resolve({
          nodes: [
            {
              id: 'relation-1',
              type: 'blocks',
              relatedIssue: Promise.resolve({ id: 'issue-456', identifier: 'TEAM-2' }),
            },
            {
              id: 'relation-2',
              type: 'related',
              relatedIssue: Promise.resolve({ id: 'issue-789', identifier: 'TEAM-3' }),
            },
          ],
        }),
    })
  }
}

export function setupGetRelationsMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
