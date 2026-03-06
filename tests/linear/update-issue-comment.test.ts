import { describe, expect, test } from 'bun:test'

import { setupUpdateIssueCommentMock } from '../../src/linear/__mocks__/update-issue-comment.js'
import { updateIssueComment } from '../../src/linear/update-issue-comment.js'

const mockApiKey = 'test-api-key'

describe('updateIssueComment', () => {
  test('updates comment successfully', async () => {
    setupUpdateIssueCommentMock()
    const result = await updateIssueComment({
      apiKey: mockApiKey,
      commentId: 'comment-123',
      body: 'Updated comment body',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('comment-123')
    expect(result.body).toBe('Updated comment body')
    expect(result.url).toBe('https://linear.app/comment/comment-123')
  })
})
