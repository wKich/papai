import { describe, expect, test } from 'bun:test'

import { setupGetRelationsMock } from '../../src/linear/__mocks__/get-relations.js'
import { getRelations } from '../../src/linear/get-relations.js'

const mockApiKey = 'test-api-key'

describe('getRelations', () => {
  test('returns relations for issue', async () => {
    setupGetRelationsMock()
    const result = await getRelations({
      apiKey: mockApiKey,
      issueId: 'issue-123',
    })

    expect(result).toHaveLength(2)
    expect(result[0]?.type).toBe('blocks')
    expect(result[0]?.relatedIdentifier).toBe('TEAM-2')
    expect(result[1]?.type).toBe('related')
    expect(result[1]?.relatedIdentifier).toBe('TEAM-3')
  })
})
