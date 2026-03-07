import { mock } from 'bun:test'

type MockRecord = Record<string, unknown>

class MockHulyClient {
  async addCollection(
    _class: unknown,
    _space: unknown,
    _attachedTo: unknown,
    _attachedToClass: unknown,
    _collection: unknown,
    _attributes: MockRecord,
  ): Promise<void> {
    // Tag reference added
  }

  async findOne(_class: unknown, query: MockRecord): Promise<unknown> {
    const className = String(_class)

    if (className.includes('Issue') && query['_id'] === 'issue-123') {
      return {
        _id: 'issue-123',
        space: 'project-123',
        title: 'Test Issue',
        identifier: 'TEAM-1',
      }
    }

    if (className.includes('Project') && query['_id'] === 'project-123') {
      return { _id: 'project-123', identifier: 'TEAM' }
    }

    return undefined
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

export function setupAddIssueLabelMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
