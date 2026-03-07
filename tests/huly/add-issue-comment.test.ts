import { beforeEach, describe, expect, test } from 'bun:test'

import { setupAddIssueCommentMock } from '../../src/huly/__mocks__/add-issue-comment.js'
import { addIssueComment } from '../../src/huly/add-issue-comment.js'
import { HulyApiError } from '../../src/huly/classify-error.js'

describe('addIssueComment', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('adds comment to issue', async () => {
    setupAddIssueCommentMock()
    const result = await addIssueComment({
      userId: 123,
      projectId: 'project-123',
      issueId: 'issue-123',
      body: 'Test comment body',
    })

    expect(result).toBeDefined()
    expect(result.body).toBe('Test comment body')
    expect(result.url).toBeDefined()
  })

  describe('error handling', () => {
    test('throws HulyApiError when issue not found', async () => {
      setupAddIssueCommentMock()
      // oxlint-disable-next-line await-thenable, no-confusing-void-expression
      await expect(
        addIssueComment({
          userId: 123,
          projectId: 'project-123',
          issueId: 'invalid-issue',
          body: 'Test comment',
        }),
      ).rejects.toThrow(HulyApiError)
    })

    test('throws HulyApiError with issue-not-found code', async () => {
      setupAddIssueCommentMock()
      let thrown = false
      try {
        await addIssueComment({
          userId: 123,
          projectId: 'project-123',
          issueId: 'invalid-issue',
          body: 'Test comment',
        })
      } catch (error) {
        thrown = true
        expect(error).toBeInstanceOf(HulyApiError)
        if (error instanceof HulyApiError) {
          expect(error.appError.code).toBe('issue-not-found')
        }
      }
      expect(thrown).toBe(true)
    })
  })
})
