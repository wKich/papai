import { mock } from 'bun:test'

export function setupAddIssueCommentFailureMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: class MockLinearClientFailure {
      createComment(): never {
        throw new Error('Issue not found')
      }
    },
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
