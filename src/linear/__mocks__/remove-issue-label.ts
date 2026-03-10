import { mock } from 'bun:test'

export class MockLinearClient {
  issueRemoveLabel(): { issue: Promise<{ id: string; identifier: string; title: string; url: string } | null> } {
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

export function setupRemoveIssueLabelMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
