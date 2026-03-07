import { mock } from 'bun:test'

type MockRecord = Record<string, unknown>

const mockLabels: MockRecord[] = [
  { _id: 'label-1', title: 'Bug', color: 0xff0000 },
  { _id: 'label-2', title: 'Feature', color: 0x00ff00 },
  { _id: 'label-3', title: 'Documentation', color: 0x0000ff },
]

class MockHulyClient {
  async findAll(_class: unknown, _query: MockRecord): Promise<unknown[]> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      return mockLabels
    }

    return []
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}

export function setupListLabelsMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
