import { describe, expect, it, test, mock, beforeEach } from 'bun:test'

import { makeTools, type MakeToolsOptions } from '../../src/tools/index.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('makeTools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  const provider = createMockProvider()

  test('includes get_current_time tool', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('get_current_time')
  })

  test('includes web_fetch when storageContextId is defined', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('web_fetch')
  })

  test('excludes web_fetch when storageContextId is undefined', () => {
    const tools = makeTools(provider, { chatUserId: 'user-1' })
    expect(tools).not.toHaveProperty('web_fetch')
  })

  test('get_current_time tool has correct structure', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools['get_current_time']?.description).toContain('current date and time')
  })

  test('excludes lookup_group_history when storageContextId is undefined', () => {
    const tools = makeTools(provider, { chatUserId: 'user-1' })
    expect(tools).not.toHaveProperty('lookup_group_history')
  })

  test('excludes lookup_group_history in DM contexts (plain userId)', () => {
    // DMs use userId as storageContextId without colon separator
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).not.toHaveProperty('lookup_group_history')
  })

  test('includes lookup_group_history in group/thread contexts (contains colon)', () => {
    // Groups use userId:groupId format (contains colon separator)
    const tools = makeTools(provider, { storageContextId: 'user-1:group-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('lookup_group_history')
    expect(tools['lookup_group_history']?.description).toContain('main group chat')
  })

  describe('identity tools', () => {
    it('should include set_my_identity tool for group chats', () => {
      const providerWithResolver = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = makeTools(providerWithResolver, {
        storageContextId: 'user-123:group-123',
        chatUserId: 'user-123',
        contextType: 'group',
      })
      expect(tools['set_my_identity']).toBeDefined()
    })

    it('should include clear_my_identity tool for group chats', () => {
      const providerWithResolver = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = makeTools(providerWithResolver, {
        storageContextId: 'user-123:group-123',
        chatUserId: 'user-123',
        contextType: 'group',
      })
      expect(tools['clear_my_identity']).toBeDefined()
    })

    it('should exclude identity tools in DM contexts', () => {
      const providerWithResolver = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = makeTools(providerWithResolver, {
        storageContextId: 'user-123',
        chatUserId: 'user-123',
        contextType: 'dm',
      })
      expect(tools['set_my_identity']).toBeUndefined()
      expect(tools['clear_my_identity']).toBeUndefined()
    })

    it('should exclude identity tools when chatUserId is undefined', () => {
      const providerWithResolver = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = makeTools(providerWithResolver)
      expect(tools['set_my_identity']).toBeUndefined()
      expect(tools['clear_my_identity']).toBeUndefined()
    })

    it('should exclude identity tools when provider has no identityResolver', () => {
      const providerWithoutResolver = createMockProvider({
        identityResolver: undefined,
      })
      const tools = makeTools(providerWithoutResolver, {
        storageContextId: 'user-123:group-123',
        chatUserId: 'user-123',
        contextType: 'group',
      })
      expect(tools['set_my_identity']).toBeUndefined()
      expect(tools['clear_my_identity']).toBeUndefined()
    })
  })

  test('normal mode includes deferred prompt tools', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('create_deferred_prompt')
    expect(tools).toHaveProperty('update_deferred_prompt')
    expect(tools).toHaveProperty('list_deferred_prompts')
    expect(tools).toHaveProperty('cancel_deferred_prompt')
    expect(tools).toHaveProperty('get_deferred_prompt')
  })

  test('proactive mode excludes deferred prompt tools', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1', mode: 'proactive' })
    expect(tools).not.toHaveProperty('create_deferred_prompt')
    expect(tools).not.toHaveProperty('update_deferred_prompt')
    expect(tools).not.toHaveProperty('list_deferred_prompts')
    expect(tools).not.toHaveProperty('cancel_deferred_prompt')
    expect(tools).not.toHaveProperty('get_deferred_prompt')
  })

  test('proactive mode still includes core task tools', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1', mode: 'proactive' })
    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
  })

  test('default mode is normal (includes deferred tools)', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('create_deferred_prompt')
  })

  test('no chatUserId skips deferred tools', () => {
    const tools = makeTools(provider)
    expect(tools).not.toHaveProperty('create_deferred_prompt')
  })

  test('includes attachment tools when capabilities present and chatUserId given', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('list_attachments')
    expect(tools).toHaveProperty('upload_attachment')
    expect(tools).toHaveProperty('remove_attachment')
  })

  test('excludes attachment tools when no chatUserId', () => {
    const tools = makeTools(provider)
    expect(tools).not.toHaveProperty('list_attachments')
    expect(tools).not.toHaveProperty('upload_attachment')
    expect(tools).not.toHaveProperty('remove_attachment')
  })

  test('includes work item tools when capabilities present', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('list_work')
    expect(tools).toHaveProperty('log_work')
    expect(tools).toHaveProperty('update_work')
    expect(tools).toHaveProperty('remove_work')
  })

  test('includes agile and sprint tools when provider exposes phase-five sprint features', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('list_agiles')
    expect(tools).toHaveProperty('list_sprints')
    expect(tools).toHaveProperty('create_sprint')
    expect(tools).toHaveProperty('update_sprint')
    expect(tools).toHaveProperty('assign_task_to_sprint')
  })

  test('includes count_tasks when provider has countTasks method and capability', () => {
    const tools = makeTools(createMockProvider(), { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).toHaveProperty('count_tasks')
  })

  test('excludes count_tasks when provider has no countTasks method', () => {
    const tools = makeTools(createMockProvider({ countTasks: undefined }), {
      storageContextId: 'user-1',
      chatUserId: 'user-1',
    })
    expect(tools).not.toHaveProperty('count_tasks')
  })

  test('excludes count_tasks when provider lacks tasks.count capability', () => {
    const limitedProvider = createMockProvider({
      capabilities: new Set([...provider.capabilities].filter((capability) => capability !== 'tasks.count')),
    })
    const tools = makeTools(limitedProvider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).not.toHaveProperty('count_tasks')
  })

  test('includes collaboration tools when capabilities and helpers are present', () => {
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
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
    const tools = makeTools(limitedProvider as typeof provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
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
    const tools = makeTools(limitedProvider as typeof provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    expect(tools).not.toHaveProperty('list_work')
    expect(tools).not.toHaveProperty('log_work')
    expect(tools).not.toHaveProperty('update_work')
    expect(tools).not.toHaveProperty('remove_work')
  })

  test('excludes find_user when provider has no listUsers helper', () => {
    const tools = makeTools(createMockProvider({ listUsers: undefined }), {
      storageContextId: 'user-1',
      chatUserId: 'user-1',
    })
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
    const tools = makeTools(limitedProvider, { storageContextId: 'user-1', chatUserId: 'user-1' })
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

  test('includes memos, recurring, and instructions tools when chatUserId provided', () => {
    const options: MakeToolsOptions = {
      storageContextId: 'user-1',
      chatUserId: 'user-1',
    }
    const tools = makeTools(provider, options)
    expect(tools).toHaveProperty('save_memo')
    expect(tools).toHaveProperty('search_memos')
    expect(tools).toHaveProperty('create_recurring_task')
    expect(tools).toHaveProperty('save_instruction')
  })

  test('excludes user-scoped tools when storageContextId is undefined', () => {
    // When storageContextId is undefined, user-scoped tools should be excluded
    const tools = makeTools(provider)
    expect(tools).not.toHaveProperty('save_memo')
    expect(tools).not.toHaveProperty('create_recurring_task')
    expect(tools).not.toHaveProperty('save_instruction')
  })

  describe('chatUserId isolation', () => {
    it('should use chatUserId for identity tools when provided', () => {
      const providerWithResolver = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // In a group chat: storageContextId is group ID, chatUserId is actual user
      const tools = makeTools(providerWithResolver, {
        storageContextId: 'group-123',
        chatUserId: 'user-456',
        contextType: 'group',
      })
      // Identity tools should be created with user-456, not group-123
      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })

    it('should work when chatUserId equals storageContextId in DM contexts', () => {
      const providerWithResolver = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // In a DM: storageContextId and chatUserId are the same
      const tools = makeTools(providerWithResolver, {
        storageContextId: 'user-123',
        chatUserId: 'user-123',
        contextType: 'dm',
      })
      // Identity tools not available in DMs by design
      expect(tools['set_my_identity']).toBeUndefined()
      expect(tools['clear_my_identity']).toBeUndefined()
    })
  })
})
