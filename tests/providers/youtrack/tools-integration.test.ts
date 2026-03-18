import { describe, expect, test } from 'bun:test'

import type { Capability } from '../../../src/providers/types.js'
import { makeTools } from '../../../src/tools/index.js'
import { createMockProvider } from '../../tools/mock-provider.js'

describe('YouTrack provider tools integration', () => {
  test('makeTools generates correct tool set for YouTrack capabilities', () => {
    // YouTrack supports granular capabilities:
    // - tasks: delete, relations
    // - projects: list, archive (NOT create, update)
    // - comments: read, create, update (NOT delete)
    // - labels: list, create, update, delete, assign
    // YouTrack does NOT support: tasks.archive, statuses.*
    const youtrackCapabilities = new Set<Capability>([
      // Tasks
      'tasks.delete',
      'tasks.relations',
      // Projects (partial - list and archive only)
      'projects.list',
      'projects.archive',
      // Comments (partial - no delete)
      'comments.read',
      'comments.create',
      'comments.update',
      // Labels (full)
      'labels.list',
      'labels.create',
      'labels.update',
      'labels.delete',
      'labels.assign',
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

    // YouTrack-supported project tools (list and archive only, NOT create/update)
    expect(toolNames).toContain('list_projects')
    expect(toolNames).toContain('archive_project')
    expect(toolNames).not.toContain('create_project')
    expect(toolNames).not.toContain('update_project')

    // YouTrack-supported comment tools (read, create, update, NOT delete)
    expect(toolNames).toContain('add_comment')
    expect(toolNames).toContain('get_comments')
    expect(toolNames).toContain('update_comment')
    expect(toolNames).not.toContain('remove_comment')

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

    // Status tools should NOT be present (YouTrack uses custom fields, not explicit status management)
    expect(toolNames).not.toContain('list_statuses')
    expect(toolNames).not.toContain('create_status')
    expect(toolNames).not.toContain('update_status')
    expect(toolNames).not.toContain('delete_status')
    expect(toolNames).not.toContain('reorder_statuses')

    // Archive tool should NOT be present (YouTrack doesn't support tasks.archive)
    expect(toolNames).not.toContain('archive_task')
  })
})
