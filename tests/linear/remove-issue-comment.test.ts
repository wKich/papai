import { describe, expect, test } from 'bun:test'

import { setupRemoveIssueCommentMock } from '../../src/linear/__mocks__/remove-issue-comment.js'
import { removeIssueComment } from '../../src/linear/remove-issue-comment.js'

const mockApiKey = 'test-api-key'

describe('removeIssueComment', () => {
  test('removes comment successfully', async () => {
    setupRemoveIssueCommentMock()
    const result = await removeIssueComment({
      apiKey: mockApiKey,
      commentId: 'comment-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('comment-123')
    expect(result.success).toBe(true)
  })
})
