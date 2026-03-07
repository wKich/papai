import { mock } from 'bun:test'

type MockRecord = Record<string, unknown>

const mockLabels = new Map<string, MockRecord>()

function parseColor(color: unknown): number {
  if (typeof color === 'number') return color
  if (typeof color === 'string') {
    if (color.startsWith('#')) return Number.parseInt(color.slice(1), 16)
    return Number.parseInt(color, 16)
  }
  return 0x000000
}

class MockHulyClient {
  async createDoc(_class: unknown, _space: unknown, attributes: MockRecord, docId: string): Promise<void> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      mockLabels.set(docId, {
        _id: docId,
        title: attributes['title'],
        description: '',
        color: parseColor(attributes['color']),
        targetClass: attributes['targetClass'],
      })
    }
  }

  async findOne(_class: unknown, query: MockRecord): Promise<unknown> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      const labelId = query['_id']
      return typeof labelId === 'string' ? mockLabels.get(labelId) : undefined
    }

    return undefined
  }

  async close(): Promise<void> {
    mockLabels.clear()
  }
}

export function setupCreateLabelMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
