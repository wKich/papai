/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

import type { PlatformClient } from '@hcengineering/api-client'
import core, { type Ref, type Doc } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'

// Mock label storage
const mockLabels = new Map<string, TagElement>()

class MockHulyClient implements Partial<PlatformClient> {
  async createDoc(_class: unknown, _space: unknown, attributes: Record<string, unknown>, docId: string): Promise<void> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      const label: TagElement = {
        _id: docId as Ref<TagElement>,
        _class: tags.class.TagElement,
        space: core.space.Workspace,
        modifiedBy: 'system' as Ref<Doc>,
        modifiedOn: Date.now(),
        createdBy: 'system' as Ref<Doc>,
        createdOn: Date.now(),
        title: attributes['title'] as string,
        description: '',
        color: this.parseColor(attributes['color']),
        targetClass: attributes['targetClass'] as Ref<Doc>,
        category: undefined,
      } as unknown as TagElement

      mockLabels.set(docId, label)
    }
  }

  async findOne<T extends Doc>(_class: unknown, query: Record<string, unknown>): Promise<T | undefined> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      const labelId = query['_id'] as string
      return mockLabels.get(labelId) as unknown as T
    }

    return undefined
  }

  private parseColor(color: unknown): number {
    if (typeof color === 'number') return color
    if (typeof color === 'string') {
      // Parse hex color like "#FF0000"
      if (color.startsWith('#')) {
        return Number.parseInt(color.slice(1), 16)
      }
      return Number.parseInt(color, 16)
    }
    return 0x000000
  }

  async close(): Promise<void> {
    // Cleanup if needed
    mockLabels.clear()
  }
}

export function setupCreateLabelMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
