import { beforeEach, describe, expect, test } from 'bun:test'

import { setupAddIssueRelationFailureMock } from '../../src/huly/__mocks__/add-issue-relation-failure.js'
import { setupAddIssueRelationNullMock } from '../../src/huly/__mocks__/add-issue-relation-null.js'
import { setupAddIssueRelationMock } from '../../src/huly/__mocks__/add-issue-relation.js'
import { addIssueRelation } from '../../src/huly/add-issue-relation.js'
import { HulyApiError } from '../../src/huly/classify-error.js'

const mockUserId = 123456

describe('addIssueRelation with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('creates blocks relation', async () => {
    setupAddIssueRelationMock()
    const result = await addIssueRelation({
      userId: mockUserId,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'blocks',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123-issue-456')
    expect(result.type).toBe('blocks')
    expect(result.relatedIssueId).toBe('issue-456')
  })

  test('creates duplicate relation', async () => {
    setupAddIssueRelationMock()
    const result = await addIssueRelation({
      userId: mockUserId,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'duplicate',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123-issue-456')
    expect(result.type).toBe('duplicate')
  })

  test('creates related relation', async () => {
    setupAddIssueRelationMock()
    const result = await addIssueRelation({
      userId: mockUserId,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'related',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123-issue-456')
    expect(result.type).toBe('related')
  })

  describe('error handling', () => {
    test('throws HulyApiError when issue not found', () => {
      setupAddIssueRelationFailureMock()
      expect(
        addIssueRelation({
          userId: mockUserId,
          issueId: 'invalid-issue',
          relatedIssueId: 'issue-456',
          type: 'blocks',
        }),
      ).rejects.toThrow(HulyApiError)
    })

    test('throws HulyApiError with issue-not-found code', async () => {
      setupAddIssueRelationFailureMock()
      let thrown = false
      try {
        await addIssueRelation({
          userId: mockUserId,
          issueId: 'invalid-issue',
          relatedIssueId: 'issue-456',
          type: 'blocks',
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

    test('throws HulyApiError when related issue not found', () => {
      setupAddIssueRelationNullMock()
      expect(
        addIssueRelation({
          userId: mockUserId,
          issueId: 'issue-123',
          relatedIssueId: 'invalid-issue',
          type: 'blocks',
        }),
      ).rejects.toThrow(HulyApiError)
    })
  })
})
