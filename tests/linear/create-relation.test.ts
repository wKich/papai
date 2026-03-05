import { describe, expect, test } from 'bun:test'

import { setupCreateRelationMock } from '../../src/linear/__mocks__/create-relation.js'
import { createRelation } from '../../src/linear/create-relation.js'

const mockApiKey = 'test-api-key'

describe('createRelation', () => {
  test('creates blocks relation', async () => {
    setupCreateRelationMock()
    const result = await createRelation({
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
    setupCreateRelationMock()
    const result = await createRelation({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'duplicate',
    })

    expect(result).toBeDefined()
  })

  test('creates related relation', async () => {
    setupCreateRelationMock()
    const result = await createRelation({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      relatedIssueId: 'issue-456',
      type: 'related',
    })

    expect(result).toBeDefined()
  })
})
