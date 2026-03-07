/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

import core, { type Ref, type Doc } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

// Mock label storage
const mockLabels = new Map<string, TagElement>([
  [
    'label-123',
    {
      _id: 'label-123' as Ref<TagElement>,
      _class: tags.class.TagElement,
      space: core.space.Workspace,
      modifiedBy: 'system' as Ref<Doc>,
      modifiedOn: Date.now(),
      createdBy: 'system' as Ref<Doc>,
      createdOn: Date.now(),
      title: 'Original Label',
      description: '',
      color: 0xff0000,
      targetClass: tracker.class.Issue,
      category: undefined,
    } as unknown as TagElement,
  ],
])

class MockHulyClient {
  async findOne<T extends Doc>(_class: unknown, query: Record<string, unknown>): Promise<T | undefined> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      const labelId = query['_id'] as string
      return mockLabels.get(labelId) as unknown as T
    }

    return undefined
  }

  async updateDoc(
    _class: unknown,
    _space: unknown,
    docId: unknown,
    operations: Record<string, unknown>,
  ): Promise<void> {
    const className = String(_class)
    const id = String(docId)

    if (className.includes('TagElement')) {
      const label = mockLabels.get(id)
      if (label) {
        if (operations['title'] !== undefined) {
          label.title = operations['title'] as string
        }
        if (operations['color'] !== undefined) {
          label.color = this.parseColor(operations['color'])
        }
        label.modifiedOn = Date.now()
        mockLabels.set(id, label)
      }
    }
  }

  private parseColor(color: unknown): number {
    if (typeof color === 'number') return color
    if (typeof color === 'string') {
      if (color.startsWith('#')) {
        return Number.parseInt(color.slice(1), 16)
      }
      return Number.parseInt(color, 16)
    }
    return 0x000000
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}

export function setupUpdateLabelMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
