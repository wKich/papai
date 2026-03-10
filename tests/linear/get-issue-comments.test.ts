import { describe, expect, test } from 'bun:test'

import { setupGetIssueCommentsMock } from '../../src/linear/__mocks__/get-issue-comments.js'
import { getIssueComments } from '../../src/linear/get-issue-comments.js'

const mockApiKey = 'test-api-key'

describe('getIssueComments', () => {
  test('returns comments for issue', async () => {
    setupGetIssueCommentsMock()
    const result = await getIssueComments({
      apiKey: mockApiKey,
      issueId: 'issue-123',
    })

    expect(result).toBeDefined()
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('comment-1')
    expect(result[0]?.body).toBe('First comment')
    expect(result[1]?.id).toBe('comment-2')
    expect(result[1]?.body).toBe('Second comment')
  })
})
