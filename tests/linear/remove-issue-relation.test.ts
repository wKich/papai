import { describe, expect, test } from 'bun:test'

import { setupRemoveIssueRelationMock } from '../../src/linear/__mocks__/remove-issue-relation.js'
import { removeIssueRelation } from '../../src/linear/remove-issue-relation.js'

const mockApiKey = 'test-api-key'

describe('removeIssueRelation', () => {
  test('removes relation successfully', async () => {
    setupRemoveIssueRelationMock()
    const result = await removeIssueRelation({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('relation-123')
    expect(result.success).toBe(true)
  })
})
