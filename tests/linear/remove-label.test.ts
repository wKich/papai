import { describe, expect, test } from 'bun:test'

import { setupRemoveLabelMock } from '../../src/linear/__mocks__/remove-label.js'
import { removeLabel } from '../../src/linear/remove-label.js'

const mockApiKey = 'test-api-key'

describe('removeLabel', () => {
  test('removes label successfully', async () => {
    setupRemoveLabelMock()
    const result = await removeLabel({
      apiKey: mockApiKey,
      labelId: 'label-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('label-123')
    expect(result.success).toBe(true)
  })
})
