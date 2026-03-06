import { describe, expect, test, beforeEach } from 'bun:test'

import { setupUpdateLabelMock } from '../../src/huly/__mocks__/update-label.js'
import { HulyApiError } from '../../src/huly/classify-error.js'
import { updateLabel } from '../../src/huly/update-label.js'

const mockUserId = 12345

describe('updateLabel with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('updates label successfully', async () => {
    setupUpdateLabelMock()
    const result = await updateLabel({
      userId: mockUserId,
      labelId: 'label-123',
      name: 'Updated Label',
      color: '#FF5733',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('label-123')
    expect(result.name).toBe('Updated Label')
    expect(result.color).toBe('#ff5733')
  })

  test('throws error when no fields provided', () => {
    expect(
      updateLabel({
        userId: mockUserId,
        labelId: 'label-123',
      }),
    ).rejects.toThrow(HulyApiError)
  })
})
