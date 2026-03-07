/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-floating-promises */
import { mock } from 'bun:test'

import type { PlatformClient } from '@hcengineering/api-client'
import tags, { type TagReference } from '@hcengineering/tags'
import tracker, { type Issue } from '@hcengineering/tracker'

// Mock storage
const mockTagReferences = new Map<string, TagReference>()

class MockHulyClient implements Partial<PlatformClient> {
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
    }

    if (className.includes('Project')) {
      return {
        _id: 'project-123',
        identifier: 'TEAM',
      } as unknown as T
    }

    return undefined
  }

  async findAll<T extends Record<string, unknown>>(_class: unknown, query: Record<string, unknown>): Promise<T[]> {
    const className = String(_class)

    if (className.includes('TagReference')) {
      const attachedTo = query['attachedTo'] as string
      const tag = query['tag'] as string

      // Return mock TagReference if looking for label-456 on issue-123
      if (attachedTo === 'issue-123' && tag === 'label-456') {
        const tagRef: TagReference = {
          _id: 'tag-ref-123' as unknown as TagReference['_id'],
          _class: tags.class.TagReference,
          space: 'project-123' as unknown as TagReference['space'],
          modifiedBy: 'system' as unknown as TagReference['modifiedBy'],
          modifiedOn: Date.now(),
          createdBy: 'system' as unknown as TagReference['createdBy'],
          createdOn: Date.now(),
          attachedTo: attachedTo as unknown as TagReference['attachedTo'],
          attachedToClass: tracker.class.Issue,
          collection: 'labels' as TagReference['collection'],
          tag: tag as unknown as TagReference['tag'],
        } as unknown as TagReference

        return [tagRef as unknown as T]
      }

      return []
    }

    return []
  }

  async removeCollection(
    _class: unknown,
    _space: unknown,
    _id: unknown,
    attachedTo: unknown,
    attachedToClass: unknown,
    collection: unknown,
  ): Promise<void> {
    const className = String(_class)

    if (className.includes('TagReference') && String(collection) === 'labels') {
      const tagRefId = String(_id)
      mockTagReferences.delete(tagRefId)
    }
  }

  async close(): Promise<void> {
    mockTagReferences.clear()
  }
}

export function setupRemoveIssueLabelMock(): void {
  mock.module('../huly-client.js', () => ({
    getHulyClient: async (): Promise<MockHulyClient> => new MockHulyClient(),
  }))
}
