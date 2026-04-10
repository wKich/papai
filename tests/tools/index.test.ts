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

  test('includes lookup_group_history tool when userId and contextId are provided', () => {
    const tools = makeTools(provider, 'user-1', 'normal', 'group-1')
    expect(tools).toHaveProperty('lookup_group_history')
    expect(tools['lookup_group_history']?.description).toContain('main group chat')
  })

  test('excludes lookup_group_history tool when userId is undefined', () => {
    const tools = makeTools(provider, undefined, 'normal', 'group-1')
    expect(tools).not.toHaveProperty('lookup_group_history')
  })

  test('excludes lookup_group_history tool when contextId is undefined', () => {
    const tools = makeTools(provider, 'user-1', 'normal', undefined)
    expect(tools).not.toHaveProperty('lookup_group_history')
  })
})
