import { describe, expect, test } from 'bun:test'

import { setupAddIssueCommentFailureMock } from '../../src/linear/__mocks__/add-issue-comment-failure.js'
import { setupAddIssueCommentNullMock } from '../../src/linear/__mocks__/add-issue-comment-null.js'
import { setupAddIssueCommentMock } from '../../src/linear/__mocks__/add-issue-comment.js'
import { addIssueComment } from '../../src/linear/add-issue-comment.js'
import { HulyApiError } from '../../src/linear/classify-error.js'

const mockApiKey = 'test-api-key'

describe('addIssueComment', () => {
  test('adds comment to issue', async () => {
    setupAddIssueCommentMock()
    const result = await addIssueComment({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      body: 'Test comment body',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('comment-123')
    expect(result.body).toBe('Test comment')
    expect(result.url).toBe('https://linear.app/comment/comment-123')
  })

  describe('error handling', () => {
    test('throws HulyApiError when issue not found', () => {
      setupAddIssueCommentFailureMock()
      expect(
        addIssueComment({
          apiKey: mockApiKey,
          issueId: 'invalid-issue',
          body: 'Test comment',
        }),
      ).rejects.toThrow(HulyApiError)
    })

    test('throws HulyApiError with issue-not-found code', async () => {
      setupAddIssueCommentFailureMock()
      let thrown = false
      try {
        await addIssueComment({
          apiKey: mockApiKey,
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

    test('throws HulyApiError when API returns null', () => {
      setupAddIssueCommentNullMock()
      expect(
        addIssueComment({
          apiKey: mockApiKey,
          issueId: 'issue-123',
          body: 'Test comment',
        }),
      ).rejects.toThrow(HulyApiError)
    })
  })
})
