import { describe, expect, test } from 'bun:test'

import { setupGetCommentsMock } from '../../src/linear/__mocks__/get-comments.js'
import { getComments } from '../../src/linear/get-comments.js'

const mockApiKey = 'test-api-key'

describe('getComments', () => {
  test('returns comments for issue', async () => {
    setupGetCommentsMock()
    const result = await getComments({
      apiKey: mockApiKey,
      issueId: 'issue-123',
    })

    expect(result).toHaveLength(2)
    expect(result[0]?.body).toBe('First comment')
    expect(result[1]?.body).toBe('Second comment')
  })
})
