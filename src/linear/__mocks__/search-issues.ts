import { mock } from 'bun:test'

export interface SearchNode {
  id: string
  identifier: string
  title: string
  priority: number
  url: string
}

export class MockLinearClient {
  searchIssues(): { nodes: SearchNode[] } {
    return {
      nodes: [
        {
          id: 'issue-1',
          identifier: 'TEAM-1',
          title: 'First issue',
          priority: 0,
          url: 'https://linear.app/issue/TEAM-1',
        },
        {
          id: 'issue-2',
          identifier: 'TEAM-2',
          title: 'Second issue',
          priority: 1,
          url: 'https://linear.app/issue/TEAM-2',
        },
      ],
    }
  }
}

export function setupSearchIssuesMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
