import { mock } from 'bun:test'

export class MockLinearClient {
  archiveIssue(): { entity: Promise<{ id: string; identifier: string; title: string; archivedAt: Date | null }> } {
    return {
      entity: Promise.resolve({
        id: 'issue-123',
        identifier: 'TEAM-1',
        title: 'Archived Issue',
        archivedAt: new Date('2025-03-05'),
      }),
    }
  }
}

export function setupArchiveIssueMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
