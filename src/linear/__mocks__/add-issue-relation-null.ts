import { mock } from 'bun:test'

export function setupAddIssueRelationNullMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: class MockLinearClientNull {
      createIssueRelation(): { issueRelation: Promise<null> } {
        return {
          issueRelation: Promise.resolve(null),
        }
      }
    },
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
