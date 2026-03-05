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

export class MockLinearClient {
  teams(): { nodes: Team[] } {
    return {
      nodes: [
        {
          id: 'team-1',
          name: 'Engineering',
          key: 'ENG',
          projects: (): Promise<{ nodes: Project[] }> =>
            Promise.resolve({
              nodes: [
                { id: 'proj-1', name: 'Project A', state: 'started' },
                { id: 'proj-2', name: 'Project B', state: 'planned' },
              ],
            }),
        },
      ],
    }
  }
}

export function setupListProjectsMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
