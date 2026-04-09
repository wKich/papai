import { describe, expect, test } from 'bun:test'

import type { z } from 'zod'

import {
  mapIssueToTask,
  mapIssueToListItem,
  mapIssueToSearchResult,
  mapComment,
  buildCustomFields,
} from '../../../src/providers/youtrack/mappers.js'

describe('mapIssueToTask', () => {
  test('maps basic issue fields', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      description: 'Task description',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1', name: 'Project', shortName: 'PROJ' },
      customFields: [
        { name: 'State', value: { name: 'Open' } },
        { name: 'Priority', value: { name: 'High' } },
        { name: 'Assignee', value: { login: 'alice' } },
      ],
      tags: [{ id: 'tag-1', name: 'bug', color: { background: '#ff0000' } }],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )

    expect(result.id).toBe('PROJ-1')
    expect(result.title).toBe('Test Task')
    expect(result.description).toBe('Task description')
    expect(result.status).toBe('Open')
    expect(result.priority).toBe('High')
    expect(result.assignee).toBe('alice')
    expect(result.projectId).toBe('proj-1')
    expect(result.url).toBe('https://example.com/issue/PROJ-1')
    expect(result.labels).toEqual([{ id: 'tag-1', name: 'bug', color: '#ff0000' }])
  })

  test('extracts reporter and updater', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      reporter: { id: 'u-1', login: 'alice', fullName: 'Alice Smith' },
      updater: { id: 'u-2', login: 'bob', fullName: 'Bob Jones' },
      votes: 5,
      commentsCount: 3,
      numberInProject: 1,
      resolved: 1704067200000,
      attachments: [{ id: 'a-1', name: 'file.pdf', url: 'https://example.com/file.pdf' }],
      parent: { issues: [{ id: '100', idReadable: 'PROJ-0', summary: 'Parent Task' }] },
      subtasks: {
        issues: [{ id: '200', idReadable: 'PROJ-2', summary: 'Subtask', resolved: null }],
      },
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )

    expect(result.reporter).toEqual({ id: 'u-1', login: 'alice', name: 'Alice Smith' })
    expect(result.updater).toEqual({ id: 'u-2', login: 'bob', name: 'Bob Jones' })
    expect(result.votes).toBe(5)
    expect(result.commentsCount).toBe(3)
    expect(result.number).toBe(1)
    expect(result.resolved).toBe('2024-01-01T00:00:00.000Z')
    expect(result.parent).toEqual({ id: '100', idReadable: 'PROJ-0', title: 'Parent Task' })
    expect(result.subtasks).toEqual([{ id: '200', idReadable: 'PROJ-2', title: 'Subtask', status: 'open' }])
  })

  test('maps subtask status based on resolved field', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      subtasks: {
        issues: [
          { id: '200', idReadable: 'PROJ-2', summary: 'Resolved Subtask', resolved: 1704067200000 },
          { id: '201', idReadable: 'PROJ-3', summary: 'Unresolved Subtask', resolved: undefined },
          { id: '202', idReadable: 'PROJ-4', summary: 'Null Resolved Subtask', resolved: null },
        ],
      },
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )

    expect(result.subtasks).toHaveLength(3)
    expect(result.subtasks?.[0]?.status).toBe('resolved')
    expect(result.subtasks?.[1]?.status).toBe('open')
    expect(result.subtasks?.[2]?.status).toBe('open')
  })

  test('handles missing reporter and updater', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )

    expect(result.reporter).toBeUndefined()
    expect(result.updater).toBeUndefined()
    expect(result.votes).toBeUndefined()
    expect(result.commentsCount).toBeUndefined()
    expect(result.number).toBeUndefined()
    expect(result.resolved).toBeUndefined()
    expect(result.attachments).toBeUndefined()
    expect(result.visibility).toBeUndefined()
    expect(result.parent).toBeUndefined()
    expect(result.subtasks).toBeUndefined()
  })

  test('extracts attachments and visibility', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      attachments: [
        {
          id: 'a-1',
          name: 'file.pdf',
          url: 'https://example.com/file.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          thumbnailURL: 'https://example.com/thumb.png',
          author: { login: 'alice' },
          created: 1704067200000,
        },
        { id: 'a-2', name: 'image.png', url: 'https://example.com/image.png' },
      ],
      watchers: {
        hasStar: true,
        issueWatchers: [
          {
            isStarred: true,
            user: {
              id: 'user-1',
              login: 'alice',
              fullName: 'Alice Example',
              email: 'alice@example.com',
            },
          },
          {
            isStarred: false,
            user: {
              id: 'user-2',
              login: 'bob',
              fullName: 'Bob Example',
            },
          },
        ],
      },
      visibility: {
        $type: 'LimitedVisibility',
        permittedGroups: [{ id: 'group-1', name: 'team-a' }],
        permittedUsers: [{ id: 'user-1', login: 'alice', fullName: 'Alice Example' }],
      },
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )

    expect(result.attachments).toHaveLength(2)
    expect(result.attachments?.[0]).toEqual({
      id: 'a-1',
      name: 'file.pdf',
      url: 'https://example.com/file.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      thumbnailUrl: 'https://example.com/thumb.png',
      author: 'alice',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    expect(result.attachments?.[1]).toEqual({
      id: 'a-2',
      name: 'image.png',
      url: 'https://example.com/image.png',
      mimeType: undefined,
      size: undefined,
      thumbnailUrl: undefined,
      author: undefined,
      createdAt: undefined,
    })
    expect(result.watchers).toEqual([
      { id: 'user-1', login: 'alice', name: 'Alice Example' },
      { id: 'user-2', login: 'bob', name: 'Bob Example' },
    ])
    expect(result.visibility).toEqual({
      kind: 'restricted',
      groups: [{ id: 'group-1', name: 'team-a' }],
      users: [{ id: 'user-1', login: 'alice', name: 'Alice Example' }],
    })
  })

  test('maps links to relations', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'OUTWARD',
          linkType: { name: 'Depend' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Blocking Task' }],
        },
      ],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )

    expect(result.relations).toEqual([{ type: 'blocks', taskId: 'PROJ-2' }])
  })

  test('omits relations when empty', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )

    expect(result.relations).toBeUndefined()
  })

  test('uses id when idReadable missing', () => {
    const issue = {
      id: '123',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )

    expect(result.id).toBe('123')
    expect(result.url).toBe('https://example.com/issue/123')
  })

  test('maps duplicate relation type', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'OUTWARD',
          linkType: { name: 'Duplicate' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Duplicate Task' }],
        },
      ],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )
    expect(result.relations).toEqual([{ type: 'duplicate', taskId: 'PROJ-2' }])
  })

  test('maps subtask relation type', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'INWARD',
          linkType: { name: 'Subtask' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Subtask' }],
        },
      ],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )
    expect(result.relations).toEqual([{ type: 'child', taskId: 'PROJ-2' }])
  })

  test('maps subtask OUTWARD direction as parent', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'OUTWARD',
          linkType: { name: 'Subtask' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Parent Task' }],
        },
      ],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )
    expect(result.relations).toEqual([{ type: 'parent', taskId: 'PROJ-2' }])
  })

  test('maps unknown relation type to related', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'BOTH',
          linkType: { name: 'Relates' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Related Task' }],
        },
      ],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )
    expect(result.relations).toEqual([{ type: 'related', taskId: 'PROJ-2' }])
  })

  test('handles custom field value as string', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [{ name: 'State', value: 'Open' }],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )
    expect(result.status).toBe('Open')
  })

  test('handles custom field object without name or login', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [{ name: 'State', value: { id: 'state-1' } }],
    }

    const result = mapIssueToTask(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueSchema>,
      'https://example.com',
    )
    expect(result.status).toBeUndefined()
  })
})

describe('mapIssueToListItem', () => {
  test('maps list item fields', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      project: { id: 'proj-1', shortName: 'PROJ' },
      customFields: [
        { name: 'State', value: { name: 'Open' } },
        { name: 'Priority', value: { name: 'High' } },
      ],
    }

    const result = mapIssueToListItem(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueListSchema>,
      'https://example.com',
    )

    expect(result.id).toBe('PROJ-1')
    expect(result.title).toBe('Test Task')
    expect(result.status).toBe('Open')
    expect(result.priority).toBe('High')
    expect(result.url).toBe('https://example.com/issue/PROJ-1')
  })

  test('extracts number and resolved for list item', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      numberInProject: 42,
      resolved: 1704067200000,
      project: { id: 'proj-1' },
      customFields: [],
    }

    const result = mapIssueToListItem(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueListSchema>,
      'https://example.com',
    )

    expect(result.number).toBe(42)
    expect(result.resolved).toBe('2024-01-01T00:00:00.000Z')
  })

  test('handles missing optional fields in list item', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      project: { id: 'proj-1' },
      customFields: [],
    }

    const result = mapIssueToListItem(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueListSchema>,
      'https://example.com',
    )

    expect(result.number).toBeUndefined()
    expect(result.resolved).toBeUndefined()
    expect(result.status).toBeUndefined()
    expect(result.priority).toBeUndefined()
  })
})

describe('mapIssueToSearchResult', () => {
  test('maps search result fields', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      project: { id: 'proj-1', shortName: 'PROJ' },
      customFields: [
        { name: 'State', value: { name: 'Open' } },
        { name: 'Priority', value: { name: 'High' } },
      ],
    }

    const result = mapIssueToSearchResult(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueListSchema>,
      'https://example.com',
    )

    expect(result.id).toBe('PROJ-1')
    expect(result.title).toBe('Test Task')
    expect(result.status).toBe('Open')
    expect(result.priority).toBe('High')
    expect(result.projectId).toBe('proj-1')
    expect(result.url).toBe('https://example.com/issue/PROJ-1')
  })

  test('uses id when idReadable missing', () => {
    const issue = {
      id: '123',
      summary: 'Test',
      project: { id: 'proj-1' },
      customFields: [],
    }

    const result = mapIssueToSearchResult(
      issue as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/issue.js').IssueListSchema>,
      'https://example.com',
    )

    expect(result.id).toBe('123')
    expect(result.url).toBe('https://example.com/issue/123')
  })
})

describe('mapComment', () => {
  test('maps comment with name', () => {
    const comment = {
      id: 'c-1',
      text: 'This is a comment',
      author: { name: 'Alice Smith', login: 'alice' },
      created: 1704067200000,
    }

    const result = mapComment(
      comment as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/comment.js').CommentSchema>,
    )

    expect(result.id).toBe('c-1')
    expect(result.body).toBe('This is a comment')
    expect(result.author).toBe('Alice Smith')
    expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z')
  })

  test('maps comment with login when name missing', () => {
    const comment = {
      id: 'c-1',
      text: 'Another comment',
      author: { login: 'bob' },
      created: 1704153600000,
    }

    const result = mapComment(
      comment as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/comment.js').CommentSchema>,
    )

    expect(result.author).toBe('bob')
    expect(result.createdAt).toBe('2024-01-02T00:00:00.000Z')
  })

  test('maps reactions with ids', () => {
    const comment = {
      id: 'c-1',
      text: 'With reactions',
      author: { login: 'bob' },
      created: 1704153600000,
      reactions: [
        {
          id: 'reaction-1',
          reaction: 'thumbs_up',
          author: {
            id: 'user-1',
            login: 'alice',
            fullName: 'Alice Example',
            email: 'alice@example.com',
          },
        },
      ],
    }

    const result = mapComment(
      comment as unknown as z.infer<typeof import('../../../src/providers/youtrack/schemas/comment.js').CommentSchema>,
    )

    expect(result.reactions).toEqual([
      {
        id: 'reaction-1',
        reaction: 'thumbs_up',
        author: { id: 'user-1', login: 'alice', name: 'Alice Example' },
        createdAt: undefined,
      },
    ])
  })

  test('returns empty array when no fields', () => {
    const result = buildCustomFields({})
    expect(result).toHaveLength(0)
  })
})
