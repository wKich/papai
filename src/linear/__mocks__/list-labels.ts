import { mock } from 'bun:test'

export interface LabelNode {
  id: string
  name: string
  color: string
}

export class MockLinearClient {
  team(): Promise<{
    labels: () => Promise<{ nodes: (LabelNode | null)[] }>
  }> {
    return Promise.resolve({
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: 'label-1', name: 'Bug', color: '#FF0000' },
            { id: 'label-2', name: 'Feature', color: '#00FF00' },
            { id: 'label-3', name: 'Documentation', color: '#0000FF' },
          ],
        }),
    })
  }
}

export function setupListLabelsMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
