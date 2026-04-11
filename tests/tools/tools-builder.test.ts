import { describe, expect, it } from 'bun:test'

import type { TaskProvider } from '../../src/providers/types.js'
import { buildTools } from '../../src/tools/tools-builder.js'
import { createMockProvider } from './mock-provider.js'

describe('buildTools', () => {
  it('should include core tools', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
    expect(tools).toHaveProperty('get_current_time')
  })

  it('should conditionally add project tools', () => {
    const provider = createMockProvider({
      capabilities: new Set([
        'projects.list',
        'projects.create',
        'projects.update',
        'projects.delete',
        'projects.team',
      ]),
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('list_projects')
    expect(tools).toHaveProperty('create_project')
    expect(tools).toHaveProperty('update_project')
    expect(tools).toHaveProperty('delete_project')
    expect(tools).toHaveProperty('list_project_team')
    expect(tools).toHaveProperty('add_project_member')
    expect(tools).toHaveProperty('remove_project_member')
  })

  it('should conditionally add comment tools', () => {
    const provider = createMockProvider({
      capabilities: new Set([
        'comments.read',
        'comments.create',
        'comments.update',
        'comments.delete',
        'comments.reactions',
      ]),
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('get_comments')
    expect(tools).toHaveProperty('add_comment')
    expect(tools).toHaveProperty('update_comment')
    expect(tools).toHaveProperty('remove_comment')
    expect(tools).toHaveProperty('add_comment_reaction')
    expect(tools).toHaveProperty('remove_comment_reaction')
  })

  it('should conditionally add deferred prompt tools in normal mode', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('create_deferred_prompt')
    expect(tools).toHaveProperty('list_deferred_prompts')
  })

  it('should not add deferred prompt tools in proactive mode', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'proactive')

    expect(tools).not.toHaveProperty('create_deferred_prompt')
    expect(tools).not.toHaveProperty('list_deferred_prompts')
  })

  it('should not add user-scoped tools when userId is undefined', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, undefined, undefined, 'normal')

    expect(tools).not.toHaveProperty('save_memo')
    expect(tools).not.toHaveProperty('list_memos')
    expect(tools).not.toHaveProperty('create_recurring_task')
    expect(tools).not.toHaveProperty('save_instruction')
  })

  it('should add lookup_group_history when contextId is a group', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123:group-1', 'normal')

    expect(tools).toHaveProperty('lookup_group_history')
  })

  it('should not add lookup_group_history when contextId is a DM', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('lookup_group_history')
  })
})
