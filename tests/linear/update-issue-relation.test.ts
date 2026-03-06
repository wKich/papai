import { describe, expect, test } from 'bun:test'

import { setupUpdateIssueRelationFailureMock } from '../../src/linear/__mocks__/update-issue-relation-failure.js'
import { setupUpdateIssueRelationMock } from '../../src/linear/__mocks__/update-issue-relation.js'
import { HulyApiError } from '../../src/linear/classify-error.js'
import { updateIssueRelation } from '../../src/linear/update-issue-relation.js'

const mockApiKey = 'test-api-key'

describe('updateIssueRelation', () => {
  test('updates relation type successfully', async () => {
    setupUpdateIssueRelationMock()
    const result = await updateIssueRelation({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'related',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('relation-123')
    expect(result.type).toBe('related')
    expect(result.relatedIssueId).toBe('issue-456')
  })

  describe('error handling', () => {
    test('throws HulyApiError when relation not found', () => {
      setupUpdateIssueRelationFailureMock()
      expect(
        updateIssueRelation({
          apiKey: mockApiKey,
          issueId: 'issue-123',
          relatedIssueId: 'invalid-issue',
          type: 'blocks',
        }),
      ).rejects.toThrow(HulyApiError)
    })
  })
})
