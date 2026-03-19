// tests/providers/youtrack/schemas/tag.test.ts
import { describe, expect, test } from 'bun:test'

import {
  TagSchema,
  CreateTagRequestSchema,
  ListTagsRequestSchema,
  AddTagToIssueRequestSchema,
  RemoveTagFromIssueRequestSchema,
} from '../../../src/providers/youtrack/schemas/tag.js'

describe('Tag schemas', () => {
  test('TagSchema validates tag', () => {
    const valid = {
      id: '0-0',
      $type: 'IssueTag',
      name: 'Bug',
      color: { id: '0-0', $type: 'FieldStyle', background: '#FF0000' },
    }
    const result = TagSchema.parse(valid)
    expect(result.name).toBe('Bug')
  })

  test('CreateTagRequestSchema validates request', () => {
    const valid = {
      name: 'Feature',
      color: { background: '#00FF00' },
    }
    const result = CreateTagRequestSchema.parse(valid)
    expect(result.name).toBe('Feature')
  })

  test('ListTagsRequestSchema validates request', () => {
    const valid = {
      query: { fields: 'id,name,color', $skip: 0, $top: 10 },
    }
    const result = ListTagsRequestSchema.parse(valid)
    expect(result.query.fields).toBe('id,name,color')
  })

  test('AddTagToIssueRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123' },
      body: { id: '0-0', $type: 'IssueTag' },
    }
    const result = AddTagToIssueRequestSchema.parse(valid)
    expect(result.path.issueId).toBe('PROJ-123')
  })

  test('RemoveTagFromIssueRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123', tagId: '0-0' },
    }
    const result = RemoveTagFromIssueRequestSchema.parse(valid)
    expect(result.path.issueId).toBe('PROJ-123')
  })
})
