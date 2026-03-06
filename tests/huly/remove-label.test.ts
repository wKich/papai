import { describe, expect, test, beforeEach } from 'bun:test'

import { setupRemoveLabelMock } from '../../src/huly/__mocks__/remove-label.js'
import { removeLabel } from '../../src/huly/remove-label.js'

const mockUserId = 12345

describe('removeLabel with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('removes label successfully', async () => {
    setupRemoveLabelMock()
    const result = await removeLabel({
      userId: mockUserId,
      labelId: 'label-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('label-123')
    expect(result.success).toBe(true)
  })
})
