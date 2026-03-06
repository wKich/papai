import { mock } from 'bun:test'

export class MockLinearClient {
  project(): Promise<{ archive: () => Promise<void> }> {
    return Promise.resolve({
      archive: () => Promise.resolve(),
    })
  }
}

export function setupArchiveProjectMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
