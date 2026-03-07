import { mock } from 'bun:test'

type MockRecord = Record<string, unknown>

function createMockLabels(): Map<string, MockRecord> {
  return new Map<string, MockRecord>([['label-123', { _id: 'label-123', title: 'Label to Remove', color: 0xff0000 }]])
}

class MockHulyClient {
  private mockLabels: Map<string, MockRecord>

  constructor() {
    this.mockLabels = createMockLabels()
  }

  async findOne(_class: unknown, query: MockRecord): Promise<unknown> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      const labelId = query['_id']
      return typeof labelId === 'string' ? this.mockLabels.get(labelId) : undefined
    }

    return undefined
  }

  async removeDoc(_class: unknown, _space: unknown, docId: unknown): Promise<void> {
    const className = String(_class)
    const id = typeof docId === 'string' ? docId : ''

    if (className.includes('TagElement')) {
      this.mockLabels.delete(id)
    }
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}

export function setupRemoveLabelMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
