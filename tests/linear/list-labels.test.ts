import { describe, expect, test } from 'bun:test'

import { setupListLabelsMock } from '../../src/linear/__mocks__/list-labels.js'
import { listLabels } from '../../src/linear/list-labels.js'

const mockApiKey = 'test-api-key'

describe('listLabels', () => {
  test('returns labels for team', async () => {
    setupListLabelsMock()
    const result = await listLabels({
      apiKey: mockApiKey,
      teamId: 'team-123',
    })

    expect(result).toHaveLength(3)
    expect(result[0]?.name).toBe('Bug')
    expect(result[1]?.name).toBe('Feature')
    expect(result[2]?.name).toBe('Documentation')
  })
})
