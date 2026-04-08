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

  test('includes attachment tools when capabilities present and userId given', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools).toHaveProperty('list_attachments')
    expect(tools).toHaveProperty('upload_attachment')
    expect(tools).toHaveProperty('remove_attachment')
  })

  test('excludes attachment tools when no userId', () => {
    const tools = makeTools(provider)
    expect(tools).not.toHaveProperty('list_attachments')
    expect(tools).not.toHaveProperty('upload_attachment')
    expect(tools).not.toHaveProperty('remove_attachment')
  })

  test('includes work item tools when capabilities present', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools).toHaveProperty('list_work')
    expect(tools).toHaveProperty('log_work')
    expect(tools).toHaveProperty('update_work')
    expect(tools).toHaveProperty('remove_work')
  })

  test('includes collaboration tools when capabilities and helpers are present', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools).toHaveProperty('find_user')
    expect(tools).toHaveProperty('list_watchers')
    expect(tools).toHaveProperty('add_watcher')
    expect(tools).toHaveProperty('remove_watcher')
    expect(tools).toHaveProperty('add_vote')
    expect(tools).toHaveProperty('remove_vote')
    expect(tools).toHaveProperty('set_visibility')
    expect(tools).toHaveProperty('add_comment_reaction')
    expect(tools).toHaveProperty('remove_comment_reaction')
    expect(tools).toHaveProperty('list_project_team')
    expect(tools).toHaveProperty('add_project_member')
    expect(tools).toHaveProperty('remove_project_member')
  })

  test('excludes attachment tools when provider lacks capabilities', () => {
    const { capabilities, ...rest } = provider
    const limitedProvider = {
      ...rest,
      capabilities: new Set([...capabilities].filter((c) => !c.startsWith('attachments'))),
    }
    const tools = makeTools(limitedProvider as typeof provider, 'user-1')
    expect(tools).not.toHaveProperty('list_attachments')
    expect(tools).not.toHaveProperty('upload_attachment')
    expect(tools).not.toHaveProperty('remove_attachment')
  })

  test('excludes work item tools when provider lacks capabilities', () => {
    const { capabilities, ...rest } = provider
    const limitedProvider = {
      ...rest,
      capabilities: new Set([...capabilities].filter((c) => !c.startsWith('workItems'))),
    }
    const tools = makeTools(limitedProvider as typeof provider, 'user-1')
    expect(tools).not.toHaveProperty('list_work')
    expect(tools).not.toHaveProperty('log_work')
    expect(tools).not.toHaveProperty('update_work')
    expect(tools).not.toHaveProperty('remove_work')
  })

  test('excludes find_user when provider has no listUsers helper', () => {
    const tools = makeTools(createMockProvider({ listUsers: undefined }), 'user-1')
    expect(tools).not.toHaveProperty('find_user')
  })

  test('excludes collaboration tools when provider lacks related capabilities', () => {
    const limitedProvider = createMockProvider({
      capabilities: new Set(
        [...provider.capabilities].filter(
          (capability) =>
            capability !== 'tasks.watchers' &&
            capability !== 'tasks.votes' &&
            capability !== 'tasks.visibility' &&
            capability !== 'comments.reactions' &&
            capability !== 'projects.team',
        ),
      ),
    })

    const tools = makeTools(limitedProvider, 'user-1')
    expect(tools).not.toHaveProperty('list_watchers')
    expect(tools).not.toHaveProperty('add_watcher')
    expect(tools).not.toHaveProperty('remove_watcher')
    expect(tools).not.toHaveProperty('add_vote')
    expect(tools).not.toHaveProperty('remove_vote')
    expect(tools).not.toHaveProperty('set_visibility')
    expect(tools).not.toHaveProperty('add_comment_reaction')
    expect(tools).not.toHaveProperty('remove_comment_reaction')
    expect(tools).not.toHaveProperty('list_project_team')
    expect(tools).not.toHaveProperty('add_project_member')
    expect(tools).not.toHaveProperty('remove_project_member')
  })
})
