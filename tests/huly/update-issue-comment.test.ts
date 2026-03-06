import { beforeEach, describe, expect, test } from 'bun:test'

import { setupUpdateIssueCommentMock } from '../../src/huly/__mocks__/update-issue-comment.js'
import { updateIssueComment } from '../../src/huly/update-issue-comment.js'

describe('updateIssueComment', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('updates comment successfully', async () => {
    setupUpdateIssueCommentMock()
    const result = await updateIssueComment({
      userId: 123,
      projectId: 'project-123',
      issueId: 'issue-123',
      commentId: 'comment-123',
      body: 'Updated comment body',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('comment-123')
    expect(result.body).toBe('Updated comment body')
    expect(result.url).toBeDefined()
  })
})
