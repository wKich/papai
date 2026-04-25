import { describe, expect, test } from 'bun:test'

import { getToolMetadata, isReadOnlyTool, TOOL_METADATA } from '../../src/tools/tool-metadata.js'

describe('tool metadata', () => {
  test('tags core tools with domain, operation, and risk', () => {
    expect(getToolMetadata('create_task')).toEqual({
      domain: 'task',
      operation: 'create',
      risk: 'write',
    })
    expect(getToolMetadata('get_task')).toEqual({
      domain: 'task',
      operation: 'read',
      risk: 'read',
    })
  })

  test('tags destructive and open-world tools distinctly', () => {
    expect(getToolMetadata('delete_task')?.risk).toBe('destructive')
    expect(getToolMetadata('web_fetch')).toEqual({
      domain: 'web',
      operation: 'read',
      risk: 'open-world',
    })
  })

  test('identifies read-only tools', () => {
    expect(isReadOnlyTool('list_tasks')).toBe(true)
    expect(isReadOnlyTool('create_task')).toBe(false)
    expect(isReadOnlyTool('web_fetch')).toBe(false)
  })

  test('covers representative high-pollution tool clusters', () => {
    for (const name of [
      'create_deferred_prompt',
      'pause_recurring_task',
      'add_comment_reaction',
      'assign_task_to_sprint',
      'run_saved_query',
    ]) {
      expect(TOOL_METADATA[name]).toBeDefined()
    }
  })
})
