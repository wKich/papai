import { describe, expect, test } from 'bun:test'

import { setupUpdateLabelMock } from '../../src/linear/__mocks__/update-label.js'
import { LinearApiError } from '../../src/linear/classify-error.js'
import { updateLabel } from '../../src/linear/update-label.js'

const mockApiKey = 'test-api-key'

describe('updateLabel', () => {
  test('updates label successfully', async () => {
    setupUpdateLabelMock()
    const result = await updateLabel({
      apiKey: mockApiKey,
      labelId: 'label-123',
      name: 'Updated Label',
      color: '#FF5733',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('label-123')
    expect(result.name).toBe('Updated Label')
    expect(result.color).toBe('#FF5733')
  })

  test('throws error when no fields provided', () => {
    setupUpdateLabelMock()
    expect(
      updateLabel({
        apiKey: mockApiKey,
        labelId: 'label-123',
      }),
    ).rejects.toThrow(LinearApiError)
  })
})
