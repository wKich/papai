import { beforeEach, describe, expect, test } from 'bun:test'

import { setupGetIssueCommentsMock } from '../../src/huly/__mocks__/get-issue-comments.js'
import { getIssueComments } from '../../src/huly/get-issue-comments.js'

describe('getIssueComments', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('returns comments for issue', async () => {
    setupGetIssueCommentsMock()
    const result = await getIssueComments({
      userId: 123,
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
