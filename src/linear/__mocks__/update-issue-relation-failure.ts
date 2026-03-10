import { mock } from 'bun:test'

export function setupUpdateIssueRelationFailureMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: class MockLinearClientFailure {
      issue(): Promise<{
        relations: () => Promise<{
          nodes: Array<{ id: string; type: string; relatedIssue: { id: string } }>
        }>
      }> {
        throw new Error('Relation not found')
      }
    },
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
