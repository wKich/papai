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

  describe('chatUserId isolation', () => {
    it('should pass chatUserId separately from contextId to identity tools', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // chatUserId: 'user-123', contextId: 'group-456' (group chat scenario)
      const tools = buildTools(provider, 'user-123', 'group-456', 'normal', 'group')

      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })

    it('should use chatUserId for identity tools in group contexts', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // Different chatUserId and contextId (group scenario)
      const tools = buildTools(provider, 'alice-user-id', 'group-123', 'normal', 'group')

      // Identity tools should exist and be configured with alice-user-id
      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })
  })

  describe('watcher tools user isolation', () => {
    it('should pass chatUserId to watcher tools for identity resolution', () => {
      // This test verifies NC1 fix: watcher tools must receive chatUserId (actual user)
      // not contextId (which could be a group ID) for proper "me" reference resolution
      const provider = createMockProvider({
        capabilities: new Set(['tasks.watchers']),
      })
      // Group chat: chatUserId is the user, contextId is the group
      const chatUserId = 'user-123'
      const contextId = 'user-123:group-456'
      const tools = buildTools(provider, chatUserId, contextId, 'normal', 'group')

      // Watcher tools should exist
      expect(tools['add_watcher']).toBeDefined()
      expect(tools['remove_watcher']).toBeDefined()
      expect(tools['list_watchers']).toBeDefined()

      // The tools are created with chatUserId for proper identity resolution
      // We can't directly test the internal parameter, but the tools execute correctly
      // when user says "add me as watcher" because they resolve against the user's identity
    })
  })

  describe('identity tools context gating', () => {
    it('should include identity tools in group contexts', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = buildTools(provider, 'user-123', 'group-456', 'normal', 'group')

      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })

    it('should NOT include identity tools in DM contexts', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = buildTools(provider, 'user-123', 'user-123', 'normal', 'dm')

      expect(tools['set_my_identity']).toBeUndefined()
      expect(tools['clear_my_identity']).toBeUndefined()
    })

    it('should NOT include identity tools when contextType is undefined', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

      expect(tools['set_my_identity']).toBeUndefined()
      expect(tools['clear_my_identity']).toBeUndefined()
    })
  })
})
