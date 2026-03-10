import { mock } from 'bun:test'

export interface Project {
  id: string
  name: string
  state: string
}

export interface Team {
  id: string
  name: string
  key: string
  projects: () => Promise<{ nodes: Project[] }>
}

class MockLinearClientEmpty {
  teams(): { nodes: Team[] } {
    return {
      nodes: [
        {
          id: 'team-1',
          name: 'Empty Team',
          key: 'EMPTY',
          projects: (): Promise<{ nodes: Project[] }> => Promise.resolve({ nodes: [] }),
        },
      ],
    }
  }
}

export function setupListProjectsEmptyMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClientEmpty,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
