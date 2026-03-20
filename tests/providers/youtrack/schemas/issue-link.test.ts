// tests/providers/youtrack/schemas/issue-link.test.ts
import { describe, expect, test } from 'bun:test'

import { IssueLinkSchema } from '../../../../src/providers/youtrack/schemas/issue-link.js'

describe('Issue link schemas', () => {
  test('IssueLinkSchema validates embedded link', () => {
    const valid = {
      id: '0-0',
      $type: 'IssueLink',
      direction: 'OUTWARD',
      linkType: {
        id: '0-0',
        $type: 'IssueLinkType',
        name: 'Relates',
        directed: false,
      },
      issues: [
        {
          id: '0-0',
          idReadable: 'PROJ-456',
          summary: 'Related issue',
        },
      ],
    }
    const result = IssueLinkSchema.parse(valid)
    expect(result.linkType?.name).toBe('Relates')
    expect(result.direction).toBe('OUTWARD')
  })
})
