import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeTools } from '../../src/tools/index.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('makeTools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  const provider = createMockProvider()

  test('includes get_current_time tool', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools).toHaveProperty('get_current_time')
  })

  test('get_current_time tool has correct structure', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools['get_current_time']?.description).toContain('current date and time')
  })
})
