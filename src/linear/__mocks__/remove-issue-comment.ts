import { mock } from 'bun:test'

export interface MockChatMessage {
  _id: string
  message: string
  modifiedOn: number
  createdOn: number
  attachedTo: string
}

export class MockHulyClient {
  async findOne(_classRef: unknown, query: { _id?: string; attachedTo?: string }): Promise<unknown> {
    if (query._id === 'issue-123') {
      return {
        _id: 'issue-123',
        identifier: 'TEST-123',
        title: 'Test Issue',
        space: 'project-123',
      }
    }
    if (query._id === 'comment-123' && query.attachedTo === 'issue-123') {
      return {
        _id: 'comment-123',
        message: 'Comment to delete',
        modifiedOn: Date.now(),
        createdOn: Date.now(),
        attachedTo: 'issue-123',
      }
    }
    return undefined
  }

  async removeCollection(
    _classRef: unknown,
    _space: unknown,
    _docId: unknown,
    _attachedTo: unknown,
    _attachedToClass: unknown,
    _collection: string,
  ): Promise<void> {
    // Mock remove succeeds
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

export function setupRemoveIssueCommentMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
