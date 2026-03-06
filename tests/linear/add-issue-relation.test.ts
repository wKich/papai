import { describe, expect, test } from 'bun:test'

import { setupAddIssueRelationFailureMock } from '../../src/linear/__mocks__/add-issue-relation-failure.js'
import { setupAddIssueRelationNullMock } from '../../src/linear/__mocks__/add-issue-relation-null.js'
import { setupAddIssueRelationMock } from '../../src/linear/__mocks__/add-issue-relation.js'
import { addIssueRelation } from '../../src/linear/add-issue-relation.js'
import { HulyApiError } from '../../src/linear/classify-error.js'

const mockApiKey = 'test-api-key'

describe('addIssueRelation', () => {
  test('creates blocks relation', async () => {
    setupAddIssueRelationMock()
    const result = await addIssueRelation({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'blocks',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('relation-123')
    expect(result.type).toBe('blocks')
  })

  test('creates duplicate relation', async () => {
    setupAddIssueRelationMock()
    const result = await addIssueRelation({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'duplicate',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('relation-123')
  })

  test('creates related relation', async () => {
    setupAddIssueRelationMock()
    const result = await addIssueRelation({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'related',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('relation-123')
  })

  describe('error handling', () => {
    test('throws HulyApiError when issue not found', () => {
      setupAddIssueRelationFailureMock()
      expect(
        addIssueRelation({
          apiKey: mockApiKey,
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
          apiKey: mockApiKey,
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

    test('throws HulyApiError when API returns null', () => {
      setupAddIssueRelationNullMock()
      expect(
        addIssueRelation({
          apiKey: mockApiKey,
          issueId: 'issue-123',
          relatedIssueId: 'issue-456',
          type: 'blocks',
        }),
      ).rejects.toThrow(HulyApiError)
    })
  })
})
