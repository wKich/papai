import { mock } from 'bun:test'

export function setupUpdateProjectFailureMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: class MockLinearClientFailure {
      updateProject(): never {
        throw new Error('Project not found')
      }
    },
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
