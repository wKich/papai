import { mock } from 'bun:test'

export function setupUpdateIssueFailureMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: class MockLinearClientFailure {
      issue(): never {
        throw new Error('Unauthorized')
      }
    },
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
