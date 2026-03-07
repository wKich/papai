import { mock } from 'bun:test'

type MockRecord = Record<string, unknown>

class MockHulyClient {
  async findOne(_class: unknown, query: MockRecord): Promise<unknown> {
    const className = String(_class)

    if (className.includes('Issue') && query['_id'] === 'issue-123') {
      return { _id: 'issue-123', identifier: 'TEAM-1', title: 'Test Issue', space: 'project-123' }
    }

    if (className.includes('Project') && query['_id'] === 'project-123') {
      return { _id: 'project-123', identifier: 'TEAM' }
    }

    return undefined
  }

  async findAll(_class: unknown, query: MockRecord): Promise<unknown[]> {
    const className = String(_class)

    if (className.includes('TagReference')) {
      const attachedTo = query['attachedTo']
      const tag = query['tag']

      if (attachedTo === 'issue-123' && tag === 'label-456') {
        return [{ _id: 'tag-ref-123', attachedTo: 'issue-123', tag: 'label-456' }]
      }
    }

    return []
  }

  async removeCollection(
    _class: unknown,
    _space: unknown,
    _id: unknown,
    _attachedTo: unknown,
    _attachedToClass: unknown,
    _collection: string,
  ): Promise<void> {
    // Mock remove succeeds
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupRemoveIssueLabelMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
