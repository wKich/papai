import { mock } from 'bun:test'

import { makeRank } from '@hcengineering/rank'

type MockRecord = Record<string, unknown>

function createMockProjects(): Map<string, MockRecord> {
  return new Map([
    [
      'project-123',
      {
        _id: 'project-123',
        identifier: 'P',
        defaultIssueStatus: 'status-1',
        sequence: 0,
      },
    ],
    [
      'team-123',
      {
        _id: 'team-123',
        identifier: 'TEAM',
        defaultIssueStatus: 'status-1',
        sequence: 0,
      },
    ],
  ])
}

class MockHulyClient {
  private mockIssues: Map<string, MockRecord>
  private mockProjects: Map<string, MockRecord>

  constructor() {
    this.mockIssues = new Map<string, MockRecord>()
    this.mockProjects = createMockProjects()
  }

  async findOne(
    _class: unknown,
    query: Record<string, unknown>,
    options?: { sort?: Record<string, unknown> },
  ): Promise<MockRecord | undefined> {
    const className = String(_class)

    if (className.includes('Project')) {
      const rawId = query['_id']
      const projectId = typeof rawId === 'string' ? rawId : ''
      return this.mockProjects.get(projectId)
    }

    if (className.includes('Issue')) {
      if (options?.sort?.['rank'] !== undefined) {
        const issues = Array.from(this.mockIssues.values())
        return issues.length > 0 ? issues[issues.length - 1] : undefined
      }
      const rawId = query['_id']
      const issueId = typeof rawId === 'string' ? rawId : ''
      return this.mockIssues.get(issueId)
    }

    return undefined
  }

  async updateDoc(
    _class: unknown,
    _space: unknown,
    docId: unknown,
    operations: Record<string, unknown>,
    _getResult?: boolean,
  ): Promise<void> {
    const className = String(_class)
    const id = String(docId)

    if (className.includes('Project')) {
      const project = this.mockProjects.get(id)
      if (project !== undefined) {
        const inc = operations['$inc']
        if (typeof inc === 'object' && inc !== null && 'sequence' in inc) {
          const currentSeq = typeof project['sequence'] === 'number' ? project['sequence'] : 0
          project['sequence'] = currentSeq + 1
        }
      }
    }
  }

  async uploadMarkup(
    _class: unknown,
    _objectId: unknown,
    _attribute: string,
    _markup: string,
    _format: string,
  ): Promise<string> {
    return 'mock-markup-ref'
  }

  async addCollection(
    _class: unknown,
    space: unknown,
    _attachedTo: unknown,
    _attachedToClass: unknown,
    _collection: string,
    attributes: Record<string, unknown>,
    docId: string,
  ): Promise<void> {
    const className = String(_class)

    if (className.includes('Issue')) {
      this.mockIssues.set(docId, {
        _id: docId,
        space,
        title: attributes['title'],
        description: attributes['description'],
        status: attributes['status'],
        number: attributes['number'],
        identifier: attributes['identifier'],
        priority: attributes['priority'],
        assignee: attributes['assignee'],
        estimation: attributes['estimation'],
        remainingTime: attributes['remainingTime'],
        reportedTime: attributes['reportedTime'],
        reports: attributes['reports'],
        subIssues: attributes['subIssues'],
        parents: attributes['parents'],
        childInfo: attributes['childInfo'],
        dueDate: attributes['dueDate'],
        rank: attributes['rank'] ?? makeRank(undefined, undefined),
      })
    }
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}

export function setupCreateIssueMock(): void {
  void mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
