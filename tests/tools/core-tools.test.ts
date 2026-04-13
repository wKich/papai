import { describe, expect, it } from 'bun:test'

import { makeCoreTools } from '../../src/tools/core-tools.js'
import { createMockProvider } from './mock-provider.js'

describe('makeCoreTools', () => {
  it('should return core tools', () => {
    const provider = createMockProvider()
    const tools = makeCoreTools(provider, 'user-123')

    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
    expect(tools).toHaveProperty('get_current_time')
  })

  it('should work without userId', () => {
    const provider = createMockProvider()
    const tools = makeCoreTools(provider)

    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
    expect(tools).toHaveProperty('get_current_time')
  })
})
