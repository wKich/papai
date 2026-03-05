import { describe, expect, test } from 'bun:test'

import { setupAddCommentMock } from './__mocks__/add-comment.js'
import { addComment } from './add-comment.js'

const mockApiKey = 'test-api-key'

describe('addComment', () => {
  test('adds comment to issue', async () => {
    setupAddCommentMock()
    const result = await addComment({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      body: 'Test comment',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('comment-123')
    expect(result.body).toBe('Test comment')
    expect(result.url).toBeDefined()
  })
})
