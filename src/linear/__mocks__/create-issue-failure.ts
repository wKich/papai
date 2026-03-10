import { mock } from 'bun:test'

export function setupCreateIssueFailureMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: class MockLinearClientFailure {
      createIssue(): never {
        throw new Error('Authentication failed')
      }
    },
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
