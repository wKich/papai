import { mock } from 'bun:test'

export class MockLinearClient {
  updateIssueLabel(): { issueLabel: Promise<{ id: string; name: string; color: string }> } {
    return {
      issueLabel: Promise.resolve({
        id: 'label-123',
        name: 'Updated Label',
        color: '#FF5733',
      }),
    }
  }
}

export function setupUpdateLabelMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
