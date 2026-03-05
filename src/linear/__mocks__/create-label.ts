import { mock } from 'bun:test'

export class MockLinearClient {
  createIssueLabel(): { issueLabel: Promise<{ id: string; name: string; color: string } | null> } {
    return {
      issueLabel: Promise.resolve({
        id: 'label-123',
        name: 'Test Label',
        color: '#FF0000',
      }),
    }
  }
}

export function setupCreateLabelMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
