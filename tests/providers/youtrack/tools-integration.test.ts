import { describe, expect, test } from 'bun:test'

import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import { YouTrackProvider } from '../../../src/providers/youtrack/index.js'
import { makeTools } from '../../../src/tools/index.js'

const createConfig = (): YouTrackConfig => ({
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
})

describe('YouTrack provider tools integration', () => {
  test('makeTools generates correct tool set for the real YouTrack provider', () => {
    const provider = new YouTrackProvider(createConfig())

    const tools = makeTools(provider)
    const toolNames = Object.keys(tools)

    // Core tools always present
    expect(toolNames).toContain('create_task')
    expect(toolNames).toContain('get_task')
    expect(toolNames).toContain('update_task')
    expect(toolNames).toContain('list_tasks')
    expect(toolNames).toContain('search_tasks')
    expect(toolNames).toContain('find_user')
    expect(toolNames).toContain('get_current_user')
    expect(toolNames).toContain('count_tasks')

    // YouTrack-supported project tools (full CRUD)
    expect(toolNames).toContain('get_project')
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
    expect(toolNames).toContain('list_agiles')
    expect(toolNames).toContain('list_sprints')
    expect(toolNames).toContain('create_sprint')
    expect(toolNames).toContain('update_sprint')
    expect(toolNames).toContain('assign_task_to_sprint')
    expect(toolNames).toContain('get_task_history')
    expect(toolNames).toContain('list_saved_queries')
    expect(toolNames).toContain('run_saved_query')
    expect(toolNames).toContain('apply_youtrack_command')
  })
})
