import { mock } from 'bun:test'

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

export function setupCreateRelationMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
