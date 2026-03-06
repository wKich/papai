import { beforeEach, describe, expect, test } from 'bun:test'

import { setupRemoveIssueCommentMock } from '../../src/huly/__mocks__/remove-issue-comment.js'
import { removeIssueComment } from '../../src/huly/remove-issue-comment.js'

describe('removeIssueComment', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('removes comment successfully', async () => {
    setupRemoveIssueCommentMock()
    const result = await removeIssueComment({
      userId: 123,
      projectId: 'project-123',
      issueId: 'issue-123',
      commentId: 'comment-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('comment-123')
    expect(result.success).toBe(true)
  })
})
