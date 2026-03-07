import { mock } from 'bun:test'

type MockRecord = Record<string, unknown>

function parseColor(color: unknown): number {
  if (typeof color === 'number') return color
  if (typeof color === 'string') {
    if (color.startsWith('#')) return Number.parseInt(color.slice(1), 16)
    return Number.parseInt(color, 16)
  }
  return 0x000000
}

const mockLabels = new Map<string, MockRecord>([
  ['label-123', { _id: 'label-123', title: 'Original Label', color: 0xff0000 }],
])

class MockHulyClient {
  async findOne(_class: unknown, query: MockRecord): Promise<unknown> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      const labelId = query['_id']
      return typeof labelId === 'string' ? mockLabels.get(labelId) : undefined
    }

    return undefined
  }

  async updateDoc(_class: unknown, _space: unknown, docId: unknown, operations: MockRecord): Promise<void> {
    const className = String(_class)
    const id = typeof docId === 'string' ? docId : ''

    if (className.includes('TagElement') && id !== '') {
      const label = mockLabels.get(id)
      if (label !== undefined) {
        if (operations['title'] !== undefined) {
          label['title'] = operations['title']
        }
        if (operations['color'] !== undefined) {
          label['color'] = parseColor(operations['color'])
        }
        label['modifiedOn'] = Date.now()
        mockLabels.set(id, label)
      }
    }
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}

export function setupUpdateLabelMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
