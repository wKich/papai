import { beforeEach, describe, expect, test } from 'bun:test'

import { setupUpdateIssueRelationFailureMock } from '../../src/linear/__mocks__/update-issue-relation-failure.js'
import { setupUpdateIssueRelationMock } from '../../src/linear/__mocks__/update-issue-relation.js'
import { HulyApiError } from '../../src/linear/classify-error.js'
import { updateIssueRelation } from '../../src/linear/update-issue-relation.js'

const mockUserId = 123456

describe('updateIssueRelation with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('updates relation type successfully', async () => {
    setupUpdateIssueRelationMock()
    const result = await updateIssueRelation({
      userId: mockUserId,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'related',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123-issue-456')
    expect(result.type).toBe('related')
    expect(result.relatedIssueId).toBe('issue-456')
  })

  describe('error handling', () => {
    test('throws HulyApiError when relation not found', () => {
      setupUpdateIssueRelationFailureMock()
      expect(
        updateIssueRelation({
          userId: mockUserId,
          issueId: 'issue-123',
          relatedIssueId: 'invalid-issue',
          type: 'blocks',
        }),
      ).rejects.toThrow(HulyApiError)
    })

    test('throws HulyApiError with relation-not-found code', async () => {
      setupUpdateIssueRelationFailureMock()
      let thrown = false
      try {
        await updateIssueRelation({
          userId: mockUserId,
          issueId: 'issue-123',
          relatedIssueId: 'invalid-issue',
          type: 'blocks',
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
