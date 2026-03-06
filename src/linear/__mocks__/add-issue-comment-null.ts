import { mock } from 'bun:test'

export function setupAddIssueCommentNullMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: class MockLinearClientNull {
      createComment(): { comment: Promise<null> } {
        return {
          comment: Promise.resolve(null),
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
