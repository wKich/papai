import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeAddWatcherTool } from '../../src/tools/add-watcher.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isTaskUserResult(value: unknown): value is { taskId: string; userId: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'taskId' in value &&
    typeof value.taskId === 'string' &&
    'userId' in value &&
    typeof value.userId === 'string'
  )
}

describe('Add Watcher Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeAddWatcherTool(createMockProvider())
    expect(tool.description).toContain('Add a watcher')
  })

  test('adds watcher to task', async () => {
    const addWatcher = mock((taskId: string, userId: string) => Promise.resolve({ taskId, userId }))
    const tool = makeAddWatcherTool(createMockProvider({ addWatcher }))

    const result: unknown = await getToolExecutor(tool)(
      { taskId: 'task-1', userId: 'user-2' },
      { toolCallId: '1', messages: [] },
    )

    if (!isTaskUserResult(result)) throw new Error('Invalid result')
    expect(result).toEqual({ taskId: 'task-1', userId: 'user-2' })
    expect(addWatcher).toHaveBeenCalledWith('task-1', 'user-2')
  })

  test('propagates provider errors', async () => {
    const tool = makeAddWatcherTool(
      createMockProvider({
        addWatcher: mock(() => Promise.reject(new Error('Watcher add failed'))),
      }),
    )

    await expect(
      getToolExecutor(tool)({ taskId: 'task-1', userId: 'user-2' }, { toolCallId: '1', messages: [] }),
    ).rejects.toThrow('Watcher add failed')
  })

  test('validates required inputs', () => {
    const tool = makeAddWatcherTool(createMockProvider())
    expect(schemaValidates(tool, { userId: 'user-1' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', userId: 'user-1' })).toBe(true)
  })
})
