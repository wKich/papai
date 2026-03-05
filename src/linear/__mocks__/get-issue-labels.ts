import { mock } from 'bun:test'

export interface LabelNode {
  id: string
  name: string
  color: string
}

export class MockLinearClient {
  issue(): Promise<{
    labels: () => Promise<{ nodes: (LabelNode | null)[] }>
  }> {
    return Promise.resolve({
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: 'label-1', name: 'Bug', color: '#FF0000' },
            { id: 'label-2', name: 'Feature', color: '#00FF00' },
          ],
        }),
    })
  }
}

export function setupGetIssueLabelsMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
