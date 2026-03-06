import { mock } from 'bun:test'

export class MockLinearClient {
  updateComment(): { comment: Promise<{ id: string; body: string; url: string }> } {
    return {
      comment: Promise.resolve({
        id: 'comment-123',
        body: 'Updated comment body',
        url: 'https://linear.app/comment/comment-123',
      }),
    }
  }
}

export function setupUpdateIssueCommentMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
