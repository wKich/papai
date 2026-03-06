import { beforeEach, describe, expect, test } from 'bun:test'

import { setupRemoveIssueRelationFailureMock } from '../../src/huly/__mocks__/remove-issue-relation-failure.js'
import { setupRemoveIssueRelationMock } from '../../src/huly/__mocks__/remove-issue-relation.js'
import { HulyApiError } from '../../src/huly/classify-error.js'
import { removeIssueRelation } from '../../src/huly/remove-issue-relation.js'

const mockUserId = 123456

describe('removeIssueRelation with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('removes relation successfully', async () => {
    setupRemoveIssueRelationMock()
    const result = await removeIssueRelation({
      userId: mockUserId,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123-issue-456')
    expect(result.success).toBe(true)
  })

  describe('error handling', () => {
    test('throws HulyApiError when relation not found', () => {
      setupRemoveIssueRelationFailureMock()
      expect(
        removeIssueRelation({
          userId: mockUserId,
          issueId: 'issue-123',
          relatedIssueId: 'invalid-issue',
        }),
      ).rejects.toThrow(HulyApiError)
    })

    test('throws HulyApiError with relation-not-found code', async () => {
      setupRemoveIssueRelationFailureMock()
      let thrown = false
      try {
        await removeIssueRelation({
          userId: mockUserId,
          issueId: 'issue-123',
          relatedIssueId: 'invalid-issue',
        })
      } catch (error) {
        thrown = true
        expect(error).toBeInstanceOf(HulyApiError)
        if (error instanceof HulyApiError) {
          expect(error.appError.code).toBe('relation-not-found')
        }
      }
      expect(thrown).toBe(true)
    })
  })
})
