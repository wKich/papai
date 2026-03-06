import { mock } from 'bun:test'

export interface MockChatMessage {
  _id: string
  message: string
  modifiedOn: number
  createdOn: number
  attachedTo: string
}

export class MockHulyClient {
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

  async findAll(_classRef: unknown, query: { attachedTo?: string }): Promise<unknown[]> {
    if (query.attachedTo === 'issue-123') {
      return [
        {
          _id: 'comment-1',
          message: 'First comment',
          modifiedOn: new Date('2025-03-01').getTime(),
          createdOn: new Date('2025-03-01').getTime(),
          attachedTo: 'issue-123',
        },
        {
          _id: 'comment-2',
          message: 'Second comment',
          modifiedOn: new Date('2025-03-02').getTime(),
          createdOn: new Date('2025-03-02').getTime(),
          attachedTo: 'issue-123',
        },
      ]
    }
    return []
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

export function setupGetIssueCommentsMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
