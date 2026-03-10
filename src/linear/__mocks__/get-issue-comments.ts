import { mock } from 'bun:test'

export interface CommentNode {
  id: string
  body: string
  createdAt: Date
}

export class MockLinearClient {
  issue(): Promise<{
    comments: () => Promise<{ nodes: (CommentNode | null)[] }>
  }> {
    return Promise.resolve({
      comments: () =>
        Promise.resolve({
          nodes: [
            { id: 'comment-1', body: 'First comment', createdAt: new Date('2025-03-01') },
            { id: 'comment-2', body: 'Second comment', createdAt: new Date('2025-03-02') },
          ],
        }),
    })
  }
}

export function setupGetIssueCommentsMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
