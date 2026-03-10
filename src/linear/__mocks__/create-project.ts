import { mock } from 'bun:test'

export class MockLinearClient {
  createProject(): { project: Promise<{ id: string; name: string; url: string } | null> } {
    return {
      project: Promise.resolve({
        id: 'project-123',
        name: 'Test Project',
        url: 'https://linear.app/project/project-123',
      }),
    }
  }
}

export function setupCreateProjectMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
