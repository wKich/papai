import { describe, expect, test } from 'bun:test'

import type { Capability } from '../../../src/providers/types.js'
import { makeTools } from '../../../src/tools/index.js'
import { createMockProvider } from '../../tools/mock-provider.js'

describe('YouTrack provider tools integration', () => {
  test('makeTools generates correct tool set for YouTrack capabilities', () => {
    // YouTrack supports full granular capabilities:
    // - tasks: delete, relations, watchers, votes, visibility
    // - projects: read, list, create, update, delete, team
    // - comments: read, create, update, delete, reactions
    // - labels: list, create, update, delete, assign
    // - statuses: full CRUD + reorder
    const youtrackCapabilities = new Set<Capability>([
      // Tasks
      'tasks.delete',
      'tasks.count',
      'tasks.relations',
      'tasks.watchers',
      'tasks.votes',
      'tasks.visibility',
      // Projects (full CRUD)
      'projects.read',
      'projects.list',
      'projects.create',
      'projects.update',
      'projects.delete',
      'projects.team',
      // Comments (full CRUD)
      'comments.read',
      'comments.create',
      'comments.update',
      'comments.delete',
      'comments.reactions',
      // Labels (full)
      'labels.list',
      'labels.create',
      'labels.update',
      'labels.delete',
      'labels.assign',
      // Statuses
      'statuses.list',
      'statuses.create',
      'statuses.update',
      'statuses.delete',
      'statuses.reorder',
    ])

    const provider = createMockProvider({
      name: 'youtrack',
      capabilities: youtrackCapabilities,
    })

    const tools = makeTools(provider)
    const toolNames = Object.keys(tools)

    // Core tools always present
    expect(toolNames).toContain('create_task')
    expect(toolNames).toContain('get_task')
    expect(toolNames).toContain('update_task')
    expect(toolNames).toContain('list_tasks')
    expect(toolNames).toContain('search_tasks')
    expect(toolNames).toContain('find_user')
    expect(toolNames).toContain('count_tasks')

    // YouTrack-supported project tools (full CRUD)
    expect(toolNames).toContain('list_projects')
    expect(toolNames).toContain('create_project')
    expect(toolNames).toContain('update_project')
    expect(toolNames).toContain('delete_project')
    expect(toolNames).toContain('list_project_team')
    expect(toolNames).toContain('add_project_member')
    expect(toolNames).toContain('remove_project_member')

    // YouTrack-supported comment tools (full CRUD)
    expect(toolNames).toContain('add_comment')
    expect(toolNames).toContain('get_comments')
    expect(toolNames).toContain('update_comment')
    expect(toolNames).toContain('remove_comment')
    expect(toolNames).toContain('add_comment_reaction')
    expect(toolNames).toContain('remove_comment_reaction')

    // YouTrack-supported label tools (full support)
    expect(toolNames).toContain('list_labels')
    expect(toolNames).toContain('create_label')
    expect(toolNames).toContain('update_label')
    expect(toolNames).toContain('remove_label')
    expect(toolNames).toContain('add_task_label')
    expect(toolNames).toContain('remove_task_label')

    // Relation tools
    expect(toolNames).toContain('add_task_relation')
    expect(toolNames).toContain('update_task_relation')
    expect(toolNames).toContain('remove_task_relation')

    // Collaboration task tools
    expect(toolNames).toContain('list_watchers')
    expect(toolNames).toContain('add_watcher')
    expect(toolNames).toContain('remove_watcher')
    expect(toolNames).toContain('add_vote')
    expect(toolNames).toContain('remove_vote')
    expect(toolNames).toContain('set_visibility')

    // Status tools are present for YouTrack state bundles
    expect(toolNames).toContain('list_statuses')
    expect(toolNames).toContain('create_status')
    expect(toolNames).toContain('update_status')
    expect(toolNames).toContain('delete_status')
    expect(toolNames).toContain('reorder_statuses')
  })
})
