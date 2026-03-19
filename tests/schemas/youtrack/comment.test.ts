// tests/providers/youtrack/schemas/comment.test.ts
import { describe, expect, test } from 'bun:test'

import {
  CommentSchema,
  CreateCommentRequestSchema,
  UpdateCommentRequestSchema,
} from '../../../schemas/youtrack/comment.js'

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

  test('CreateCommentRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123' },
      body: { text: 'New comment' },
    }
    const result = CreateCommentRequestSchema.parse(valid)
    expect(result.body.text).toBe('New comment')
  })

  test('UpdateCommentRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123', commentId: '0-0' },
      body: { text: 'Updated text' },
    }
    const result = UpdateCommentRequestSchema.parse(valid)
    expect(result.body.text).toBe('Updated text')
  })
})
