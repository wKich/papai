import { describe, expect, test } from 'bun:test'

import {
  YtIssueSchema,
  YtCommentSchema,
  YtProjectSchema,
  YtLabelSchema,
  YtIssueLinksSchema,
  YtIssueTagsSchema,
} from '../../../../src/providers/youtrack/schemas/yt-types.js'

describe('YtIssueSchema', () => {
  test('parses minimal issue', () => {
    const result = YtIssueSchema.parse({ id: '2-1', summary: 'Hello' })
    expect(result.id).toBe('2-1')
    expect(result.summary).toBe('Hello')
    expect(result.customFields).toBeUndefined()
  })

  test('parses issue with name-based custom fields', () => {
    const result = YtIssueSchema.parse({
      id: '2-1',
      summary: 'Hello',
      customFields: [
        { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: 'Normal' } },
        { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
        { $type: 'SingleUserIssueCustomField', name: 'Assignee', value: { login: 'john' } },
      ],
    })
    expect(result.customFields).toHaveLength(3)
    expect(result.customFields![0]!.name).toBe('Priority')
    expect(result.customFields![2]!.name).toBe('Assignee')
  })

  test('parses issue with links', () => {
    const result = YtIssueSchema.parse({
      id: '2-1',
      summary: 'Hello',
      links: [
        {
          direction: 'OUTWARD',
          linkType: { name: 'Depend' },
          issues: [{ id: '2-2', idReadable: 'TEST-2' }],
        },
      ],
    })
    expect(result.links).toHaveLength(1)
    expect(result.links![0]!.direction).toBe('OUTWARD')
  })

  test('allows unknown custom field $type', () => {
    const result = YtIssueSchema.parse({
      id: '2-1',
      summary: 'Hello',
      customFields: [{ $type: 'SomeFutureFieldType', name: 'X', value: null }],
    })
    expect(result.customFields![0]!.$type).toBe('SomeFutureFieldType')
  })

  test('parses null resolved timestamp', () => {
    const result = YtIssueSchema.parse({ id: '2-1', summary: 'Hello', resolved: null })
    expect(result.resolved).toBeNull()
  })
})

describe('YtCommentSchema', () => {
  test('parses comment', () => {
    const result = YtCommentSchema.parse({
      id: 'c-1',
      text: 'Hello world',
      author: { login: 'alice', name: 'Alice' },
      created: 1700000000000,
    })
    expect(result.id).toBe('c-1')
    expect(result.author?.name).toBe('Alice')
  })
})

describe('YtProjectSchema', () => {
  test('parses project', () => {
    const result = YtProjectSchema.parse({ id: 'p-1', name: 'My Project', shortName: 'MP' })
    expect(result.id).toBe('p-1')
  })
})

describe('YtLabelSchema', () => {
  test('parses label with color', () => {
    const result = YtLabelSchema.parse({ id: 't-1', name: 'bug', color: { background: '#ff0000' } })
    expect(result.color?.background).toBe('#ff0000')
  })

  test('parses label without color', () => {
    const result = YtLabelSchema.parse({ id: 't-2', name: 'feature' })
    expect(result.color).toBeUndefined()
  })
})

describe('YtIssueLinksSchema', () => {
  test('parses partial issue used for relation lookup', () => {
    const result = YtIssueLinksSchema.parse({
      id: '2-1',
      links: [{ direction: 'INWARD', linkType: { name: 'Depend' }, issues: [{ id: '2-2' }] }],
    })
    expect(result.links).toHaveLength(1)
  })
})

describe('YtIssueTagsSchema', () => {
  test('parses partial issue used for tag reads', () => {
    const result = YtIssueTagsSchema.parse({ tags: [{ id: 't-1' }, { id: 't-2' }] })
    expect(result.tags).toHaveLength(2)
  })
})
