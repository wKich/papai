import { mock } from 'bun:test'

export class MockLinearClient {
  deleteComment(): Promise<void> {
    return Promise.resolve()
  }
}

export function setupRemoveIssueCommentMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
