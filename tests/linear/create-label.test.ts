import { describe, expect, test } from 'bun:test'

import { setupCreateLabelMock } from '../../src/linear/__mocks__/create-label.js'
import { createLabel } from '../../src/linear/create-label.js'

const mockApiKey = 'test-api-key'

describe('createLabel', () => {
  test('creates label with name only', async () => {
    setupCreateLabelMock()
    const result = await createLabel({
      apiKey: mockApiKey,
      teamId: 'team-123',
      name: 'Test Label',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('label-123')
    expect(result.name).toBe('Test Label')
  })

  test('creates label with color', async () => {
    setupCreateLabelMock()
    const result = await createLabel({
      apiKey: mockApiKey,
      teamId: 'team-123',
      name: 'Test Label',
      color: '#FF0000',
    })

    expect(result).toBeDefined()
    expect(result.color).toBe('#FF0000')
  })
})
