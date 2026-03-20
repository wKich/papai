// tests/providers/youtrack/schemas/tag.test.ts
import { describe, expect, test } from 'bun:test'

import { TagSchema } from '../../../../src/providers/youtrack/schemas/tag.js'

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

  test('TagSchema accepts null color', () => {
    const valid = {
      id: '0-0',
      name: 'docs',
      color: null,
    }
    expect(() => TagSchema.parse(valid)).not.toThrow()
  })
})
