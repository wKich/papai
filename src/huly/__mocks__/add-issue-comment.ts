import { mock } from 'bun:test'

export interface MockChatMessage {
  _id: string
  message: string
  modifiedOn: number
  createdOn: number
  attachedTo: string
}

export class MockHulyClient {
  private comments: Map<string, MockChatMessage> = new Map()

  async findOne(_classRef: unknown, query: { _id?: string }): Promise<unknown> {
    if (query._id === 'issue-123') {
      return {
        _id: 'issue-123',
        identifier: 'TEST-123',
        title: 'Test Issue',
        space: 'project-123',
      }
    }
    return undefined
  }

  async addCollection(
    _classRef: unknown,
    _space: unknown,
    attachedTo: unknown,
    _attachedToClass: unknown,
    _collection: string,
    _data: { message?: string },
  ): Promise<string> {
    const commentId = `comment-${Date.now()}`
    this.comments.set(commentId, {
      _id: commentId,
      message: _data.message ?? '',
      modifiedOn: Date.now(),
      createdOn: Date.now(),
      attachedTo: typeof attachedTo === 'string' ? attachedTo : '',
    })
    return commentId
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

export function setupAddIssueCommentMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
