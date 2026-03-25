import { describe, expect, test } from 'bun:test'

import { makeTools } from '../../src/tools/index.js'
import { createMockProvider } from './mock-provider.js'

describe('makeTools', () => {
  const provider = createMockProvider()

  test('normal mode includes deferred prompt tools', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools).toHaveProperty('create_deferred_prompt')
    expect(tools).toHaveProperty('update_deferred_prompt')
    expect(tools).toHaveProperty('list_deferred_prompts')
    expect(tools).toHaveProperty('cancel_deferred_prompt')
    expect(tools).toHaveProperty('get_deferred_prompt')
  })

  test('proactive mode excludes deferred prompt tools', () => {
    const tools = makeTools(provider, 'user-1', 'proactive')
    expect(tools).not.toHaveProperty('create_deferred_prompt')
    expect(tools).not.toHaveProperty('update_deferred_prompt')
    expect(tools).not.toHaveProperty('list_deferred_prompts')
    expect(tools).not.toHaveProperty('cancel_deferred_prompt')
    expect(tools).not.toHaveProperty('get_deferred_prompt')
  })

  test('proactive mode still includes core task tools', () => {
    const tools = makeTools(provider, 'user-1', 'proactive')
    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
  })

  test('default mode is normal (includes deferred tools)', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools).toHaveProperty('create_deferred_prompt')
  })

  test('no userId skips deferred tools regardless of mode', () => {
    const tools = makeTools(provider)
    expect(tools).not.toHaveProperty('create_deferred_prompt')
  })
})
