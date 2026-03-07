import { mock } from 'bun:test'

import type { PlatformClient } from '@hcengineering/api-client'
import core, { type Ref, type Doc } from '@hcengineering/core'
import { makeRank } from '@hcengineering/rank'
import type { Issue, Project } from '@hcengineering/tracker'
import tracker, { IssuePriority } from '@hcengineering/tracker'

// Factory functions to create fresh mock data for each test
function createMockProjects(): Map<string, Project> {
  return new Map([
    [
      'project-123',
      {
        _id: 'project-123' as Ref<Project>,
        _class: tracker.class.Project,
        space: core.space.Space,
        modifiedBy: 'system' as Ref<Doc>,
        modifiedOn: Date.now(),
        createdBy: 'system' as Ref<Doc>,
        createdOn: Date.now(),
        title: 'Test Project',
        identifier: 'P',
        description: '',
        private: false,
        archived: false,
        defaultIssueStatus: 'status-1' as Ref<Doc>,
        members: [],
        owners: [],
        sequence: 0,
      } as Project,
    ],
    [
      'team-123',
      {
        _id: 'team-123' as Ref<Project>,
        _class: tracker.class.Project,
        space: core.space.Space,
        modifiedBy: 'system' as Ref<Doc>,
        modifiedOn: Date.now(),
        createdBy: 'system' as Ref<Doc>,
        createdOn: Date.now(),
        title: 'Team Project',
        identifier: 'TEAM',
        description: '',
        private: false,
        archived: false,
        defaultIssueStatus: 'status-1' as Ref<Doc>,
        members: [],
        owners: [],
        sequence: 0,
      } as Project,
    ],
  ])
}

class MockHulyClient implements Partial<PlatformClient> {
  private mockIssues: Map<string, Issue>
  private mockProjects: Map<string, Project>
  private issueSequence: number

  constructor() {
    this.mockIssues = new Map<string, Issue>()
    this.mockProjects = createMockProjects()
    this.issueSequence = 1
  }
  async findOne<T extends Doc>(
    _class: unknown,
    query: Record<string, unknown>,
    options?: { sort?: Record<string, unknown> },
  ): Promise<T | undefined> {
    const className = String(_class)

    if (className.includes('Project')) {
      const projectId = query['_id'] as string
      return this.mockProjects.get(projectId) as unknown as T
    }

    if (className.includes('Issue')) {
      if (options?.sort?.rank === -1) {
        // Return last issue for ranking
        const issues = Array.from(this.mockIssues.values())
        return issues.length > 0 ? (issues[issues.length - 1] as unknown as T) : undefined
      }
      const issueId = query['_id'] as string
      return this.mockIssues.get(issueId) as unknown as T
    }

    return undefined
  }

  async updateDoc<T extends Doc>(
    _class: unknown,
    _space: unknown,
    docId: unknown,
    operations: Record<string, unknown>,
    _getResult?: boolean,
  ): Promise<{ object: T }> {
    const className = String(_class)
    const id = String(docId)

    if (className.includes('Project')) {
      const project = this.mockProjects.get(id)
      if (project) {
        const inc = operations['$inc'] as { sequence?: number } | undefined
        if (inc?.sequence) {
          project.sequence += 1
        }
        return { object: project as unknown as T }
      }
    }

    return { object: undefined as unknown as T }
  }

  async uploadMarkup(
    _class: unknown,
    _objectId: unknown,
    _attribute: string,
    markup: string,
    _format: string,
  ): Promise<{ content: unknown[] }> {
    // Simple mock - just return empty content
    return { content: [] }
  }

  async addCollection<T extends Doc>(
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
      const issue: Issue = {
        _id: docId as Ref<Issue>,
        _class: tracker.class.Issue,
        space: space as Ref<Project>,
        modifiedBy: 'system' as Ref<Doc>,
        modifiedOn: Date.now(),
        createdBy: 'system' as Ref<Doc>,
        createdOn: Date.now(),
        title: attributes['title'] as string,
        description: attributes['description'],
        status: attributes['status'] as Ref<Doc>,
        number: attributes['number'] as number,
        kind: tracker.taskTypes.Issue,
        identifier: attributes['identifier'] as string,
        priority: attributes['priority'] as IssuePriority,
        assignee: attributes['assignee'] as Ref<Doc> | null,
        component: attributes['component'] as Ref<Doc> | null,
        estimation: attributes['estimation'] as number,
        remainingTime: attributes['remainingTime'] as number,
        reportedTime: attributes['reportedTime'] as number,
        reports: attributes['reports'] as number,
        subIssues: attributes['subIssues'] as number,
        parents: attributes['parents'] as unknown[],
        childInfo: attributes['childInfo'] as unknown[],
        dueDate: attributes['dueDate'] as number | null,
        rank: (attributes['rank'] as string) ?? makeRank(undefined, undefined),
      } as Issue

      this.mockIssues.set(docId, issue)
      this.issueSequence += 1
    }
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}

export function setupCreateIssueMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async () => new MockHulyClient(),
  }))
}
