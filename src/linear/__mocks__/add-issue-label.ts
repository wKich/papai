import { mock } from 'bun:test'

export class MockLinearClient {
  issueAddLabel(): { issue: Promise<{ id: string; identifier: string; title: string; url: string }> } {
    return {
      issue: Promise.resolve({
        id: 'issue-123',
        identifier: 'TEAM-1',
        title: 'Test Issue',
        url: 'https://linear.app/issue/TEAM-1',
      }),
    }
  }
}

export function setupAddIssueLabelMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
