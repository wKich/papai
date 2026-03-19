import { describe, expect, test } from 'bun:test'

import type { Capability } from '../../../src/providers/types.js'
import { makeTools } from '../../../src/tools/index.js'
import { createMockProvider } from '../../tools/mock-provider.js'

describe('YouTrack provider tools integration', () => {
  test('makeTools generates correct tool set for YouTrack capabilities', () => {
    // YouTrack supports full granular capabilities:
    // - tasks: delete, relations
    // - projects: read, list, create, update, archive (full CRUD)
    // - comments: read, create, update, delete (full CRUD)
    // - labels: list, create, update, delete, assign (full)
    // YouTrack does NOT support: tasks.archive, statuses.*
    const youtrackCapabilities = new Set<Capability>([
      // Tasks
      'tasks.delete',
      'tasks.relations',
      // Projects (full CRUD)
      'projects.read',
      'projects.list',
      'projects.create',
      'projects.update',
      'projects.archive',
      // Comments (full CRUD)
      'comments.read',
      'comments.create',
      'comments.update',
      'comments.delete',
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

    // YouTrack-supported project tools (full CRUD)
    expect(toolNames).toContain('list_projects')
    expect(toolNames).toContain('create_project')
    expect(toolNames).toContain('update_project')
    expect(toolNames).toContain('archive_project')

    // YouTrack-supported comment tools (full CRUD)
    expect(toolNames).toContain('add_comment')
    expect(toolNames).toContain('get_comments')
    expect(toolNames).toContain('update_comment')
    expect(toolNames).toContain('remove_comment')

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
