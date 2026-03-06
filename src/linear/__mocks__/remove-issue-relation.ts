import { mock } from 'bun:test'

export class MockLinearClient {
  issue(): Promise<{
    id: string
    relations: () => Promise<{ nodes: Array<{ id: string; relatedIssue: Promise<{ id: string } | null> }> }>
  }> {
    return Promise.resolve({
      id: 'issue-123',
      relations: () =>
        Promise.resolve({
          nodes: [
            {
              id: 'relation-123',
              relatedIssue: Promise.resolve({ id: 'issue-456' }),
            },
          ],
        }),
    })
  }

  deleteIssueRelation(): Promise<void> {
    return Promise.resolve()
  }
}

export function setupRemoveIssueRelationMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
