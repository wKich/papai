// tests/providers/youtrack/schemas/issue.test.ts
import { describe, expect, test } from 'bun:test'

import { IssueSchema } from '../../../../src/providers/youtrack/schemas/issue.js'

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
})
