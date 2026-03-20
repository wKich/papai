// tests/providers/youtrack/schemas/comment.test.ts
import { describe, expect, test } from 'bun:test'

import { CommentSchema } from '../../../../src/providers/youtrack/schemas/comment.js'

describe('Comment schemas', () => {
  test('CommentSchema validates comment', () => {
    const valid = {
      id: '0-0',
      $type: 'IssueComment',
      text: 'This is a comment',
      author: { id: '1-1', $type: 'User', login: 'john.doe' },
      created: 1700000000000,
    }
    const result = CommentSchema.parse(valid)
    expect(result.text).toBe('This is a comment')
  })
})
