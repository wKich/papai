import { mock } from 'bun:test'

import type { PlatformClient } from '@hcengineering/api-client'
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
      title: 'Label to Remove',
      description: '',
      color: 0xff0000,
      targetClass: tracker.class.Issue,
      category: undefined,
    } as unknown as TagElement,
  ],
])

class MockHulyClient implements Partial<PlatformClient> {
  async findOne<T extends Doc>(_class: unknown, query: Record<string, unknown>): Promise<T | undefined> {
    const className = String(_class)

    if (className.includes('TagElement')) {
      const labelId = query['_id'] as string
      return mockLabels.get(labelId) as unknown as T
    }

    return undefined
  }

  async removeDoc(_class: unknown, _space: unknown, docId: unknown): Promise<void> {
    const className = String(_class)
    const id = String(docId)

    if (className.includes('TagElement')) {
      mockLabels.delete(id)
    }
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}

export function setupRemoveLabelMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
