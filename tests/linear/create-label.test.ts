import { describe, expect, test, beforeEach } from 'bun:test'

import { setupCreateLabelMock } from '../../src/linear/__mocks__/create-label.js'
import { createLabel } from '../../src/linear/create-label.js'

const mockUserId = 12345

describe('createLabel with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('creates label with name only', async () => {
    setupCreateLabelMock()
    const result = await createLabel({
      userId: mockUserId,
      name: 'Test Label',
    })

    expect(result).toBeDefined()
    expect(result.id).toBeDefined()
    expect(result.name).toBe('Test Label')
    expect(result.color).toBeDefined()
  })

  test('creates label with color', async () => {
    setupCreateLabelMock()
    const result = await createLabel({
      userId: mockUserId,
      name: 'Test Label',
      color: '#FF0000',
    })

    expect(result).toBeDefined()
    expect(result.name).toBe('Test Label')
    expect(result.color).toBe('#ff0000')
  })
})
