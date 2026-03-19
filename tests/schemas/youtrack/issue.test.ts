// tests/providers/youtrack/schemas/issue.test.ts
import { describe, expect, test } from 'bun:test'

import { IssueSchema, CreateIssueRequestSchema, SearchIssuesRequestSchema } from '../../../schemas/youtrack/issue.js'

describe('Issue schemas', () => {
  test('IssueSchema validates full issue', () => {
    const valid = {
      id: '0-0',
      $type: 'Issue',
      idReadable: 'PROJ-123',
      summary: 'Test Issue',
      description: 'Description text',
      created: 1700000000000,
      updated: 1700000000001,
      project: { id: '0-0', $type: 'Project' },
      customFields: [],
      tags: [],
    }
    const result = IssueSchema.parse(valid)
    expect(result.idReadable).toBe('PROJ-123')
    expect(result.summary).toBe('Test Issue')
  })

  test('CreateIssueRequestSchema validates request', () => {
    const valid = {
      summary: 'New Issue',
      description: 'Description',
      project: { id: '0-0' },
      customFields: [
        {
          name: 'Priority',
          $type: 'SingleEnumIssueCustomField',
          value: { name: 'Major' },
        },
      ],
    }
    const result = CreateIssueRequestSchema.parse(valid)
    expect(result.summary).toBe('New Issue')
  })

  test('SearchIssuesRequestSchema validates query', () => {
    const valid = {
      query: 'for: me #Unresolved',
      fields: 'id,idReadable,summary',
    }
    const result = SearchIssuesRequestSchema.parse(valid)
    expect(result.query).toBe('for: me #Unresolved')
  })
})
