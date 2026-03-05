import { mock } from 'bun:test'

export class MockLinearClient {
  createComment(): { comment: Promise<{ id: string; body: string; url: string } | null> } {
    return {
      comment: Promise.resolve({
        id: 'comment-123',
        body: 'Test comment',
        url: 'https://linear.app/comment/comment-123',
      }),
    }
  }
}

export function setupAddCommentMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
