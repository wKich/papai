/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

import core, { type Ref, type Doc } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

// Mock label storage
const mockLabels = new Map<string, TagElement>([
  [
    'label-1',
    {
      _id: 'label-1' as Ref<TagElement>,
      _class: tags.class.TagElement,
      space: core.space.Workspace,
      modifiedBy: 'system' as Ref<Doc>,
      modifiedOn: Date.now(),
      createdBy: 'system' as Ref<Doc>,
      createdOn: Date.now(),
      title: 'Bug',
      description: '',
      color: 0xff0000,
      targetClass: tracker.class.Issue,
      category: undefined,
    } as unknown as TagElement,
  ],
  [
    'label-2',
    {
      _id: 'label-2' as Ref<TagElement>,
      _class: tags.class.TagElement,
      space: core.space.Workspace,
      modifiedBy: 'system' as Ref<Doc>,
      modifiedOn: Date.now(),
      createdBy: 'system' as Ref<Doc>,
      createdOn: Date.now(),
      title: 'Feature',
      description: '',
      color: 0x00ff00,
      targetClass: tracker.class.Issue,
      category: undefined,
    } as unknown as TagElement,
  ],
  [
    'label-3',
    {
      _id: 'label-3' as Ref<TagElement>,
      _class: tags.class.TagElement,
      space: core.space.Workspace,
      modifiedBy: 'system' as Ref<Doc>,
      modifiedOn: Date.now(),
      createdBy: 'system' as Ref<Doc>,
      createdOn: Date.now(),
      title: 'Documentation',
      description: '',
      color: 0x0000ff,
      targetClass: tracker.class.Issue,
      category: undefined,
    } as unknown as TagElement,
  ],
])

class MockHulyClient {
  async findAll<T extends Doc>(_class: unknown, query: Record<string, unknown>): Promise<Array<T> & { total: number }> {
    const className = String(_class)

    if (className.includes('TagElement') && query['targetClass'] === tracker.class.Issue) {
      const results = Array.from(mockLabels.values()) as unknown as T[]
      return Object.assign(results, { total: results.length })
    }

    return Object.assign([], { total: 0 })
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}

export function setupListLabelsMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
