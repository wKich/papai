/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

import type { PlatformClient } from '@hcengineering/api-client'
import tags, { type TagReference } from '@hcengineering/tags'
import tracker, { type Issue } from '@hcengineering/tracker'

// Mock storage
const mockTagReferences = new Map<string, TagReference>()
const mockIssues = new Map<string, Issue>()

class MockHulyClient implements Partial<PlatformClient> {
  async addCollection<_T extends Record<string, unknown>>(
    _class: unknown,
    _space: unknown,
    attachedTo: unknown,
    attachedToClass: unknown,
    collection: unknown,
    attributes: Record<string, unknown>,
  ): Promise<void> {
    const className = String(_class)

    if (className.includes('TagReference') && String(collection) === 'labels') {
      const tagRefId = `tag-ref-${Date.now()}`
      const tagRef: TagReference = {
        _id: tagRefId as unknown as TagReference['_id'],
        _class: tags.class.TagReference,
        space: _space as TagReference['space'],
        modifiedBy: 'system' as unknown as TagReference['modifiedBy'],
        modifiedOn: Date.now(),
        createdBy: 'system' as unknown as TagReference['createdBy'],
        createdOn: Date.now(),
        attachedTo: attachedTo as TagReference['attachedTo'],
        attachedToClass: attachedToClass as TagReference['attachedToClass'],
        collection: collection as TagReference['collection'],
        tag: attributes['tag'] as TagReference['tag'],
      } as unknown as TagReference

      mockTagReferences.set(tagRefId, tagRef)
    }
  }

  async findOne<T extends Record<string, unknown>>(
    _class: unknown,
    query: Record<string, unknown>,
  ): Promise<T | undefined> {
    const className = String(_class)

    if (className.includes('Issue')) {
      const issueId = query['_id'] as string
      if (issueId === 'issue-123') {
        return {
          _id: 'issue-123' as unknown as Issue['_id'],
          _class: tracker.class.Issue,
          space: 'project-123' as unknown as Issue['space'],
          title: 'Test Issue',
          identifier: 'TEAM-1',
          number: 1,
          priority: 0,
          status: 'status-1' as unknown as Issue['status'],
          assignee: null,
          component: null,
          estimation: 0,
          remainingTime: 0,
          reportedTime: 0,
          reports: 0,
          subIssues: 0,
          parents: [],
          childInfo: [],
          dueDate: null,
          rank: '0',
          modifiedOn: Date.now(),
          modifiedBy: 'system' as unknown as Issue['modifiedBy'],
          createdBy: 'system' as unknown as Issue['createdBy'],
          createdOn: Date.now(),
        } as unknown as T
      }
      return mockIssues.get(issueId) as unknown as T
    }

    if (className.includes('Project')) {
      return {
        _id: 'project-123',
        identifier: 'TEAM',
      } as unknown as T
    }

    return undefined
  }

  async close(): Promise<void> {
    mockTagReferences.clear()
    mockIssues.clear()
  }
}

export function setupAddIssueLabelMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
