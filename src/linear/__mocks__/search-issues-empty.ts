import { mock } from 'bun:test'

export interface SearchNode {
  id: string
  identifier: string
  title: string
  priority: number
  url: string
}

class MockLinearClientEmpty {
  searchIssues(): { nodes: SearchNode[] } {
    return { nodes: [] }
  }
}

export function setupSearchIssuesEmptyMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClientEmpty,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
