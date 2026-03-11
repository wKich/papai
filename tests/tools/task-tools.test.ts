import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeArchiveTaskTool } from '../../src/tools/archive-task.js'
import { makeCreateTaskTool } from '../../src/tools/create-task.js'
import { makeGetTaskTool } from '../../src/tools/get-task.js'
import { makeListTasksTool } from '../../src/tools/list-tasks.js'
import { makeSearchTasksTool } from '../../src/tools/search-tasks.js'
import { makeUpdateTaskTool } from '../../src/tools/update-task.js'
import { getToolExecutor } from '../test-helpers.js'

const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }
const mockWorkspaceId = 'ws-1'

function isTask(val: unknown): val is { id: string; title: string; number?: number; status: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'title' in val &&
    typeof val.title === 'string' &&
    'status' in val &&
    typeof val.status === 'string'
  )
}

function isTaskWithRelations(
  val: unknown,
): val is { id: string; title: string; number: number; relations: Array<{ type: string; taskId: string }> } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'title' in val &&
    typeof val.title === 'string' &&
    'number' in val &&
    typeof val.number === 'number' &&
    'relations' in val &&
    Array.isArray(val.relations)
  )
}

function isTaskArray(val: unknown): val is Array<{ title: string }> {
  return Array.isArray(val) && val.every((item) => item !== null && typeof item === 'object' && 'title' in item)
}

describe('Task Tools', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('makeCreateTaskTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeCreateTaskTool(mockConfig)
      expect(tool.description).toContain('Create a new task')
    })

    test('creates task with required title', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        createTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            number: 42,
            status: 'todo',
          }),
        ),
      }))

      const tool = makeCreateTaskTool(mockConfig)
      const result: unknown = await tool.execute(
        { title: 'Test Task', projectId: 'proj-1' },
        { toolCallId: '1', messages: [] },
      )
      if (!isTask(result)) throw new Error('Invalid result')

      expect(result.id).toBe('task-1')
      expect(result.title).toBe('Test Task')
      expect(result.number).toBe(42)
      expect(result.status).toBe('todo')
    })

    test('includes optional fields in request', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        createTask: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'task-1',
            title: String(params.title),
            number: 1,
            status: String(params.status),
          })
        }),
      }))

      const tool = makeCreateTaskTool(mockConfig)
      await tool.execute(
        {
          title: 'Test Task',
          description: 'Task description',
          priority: 'high',
          dueDate: '2026-03-15',
          status: 'in-progress',
        },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedParams?.title).toBe('Test Task')
      expect(capturedParams?.description).toBe('Task description')
      expect(capturedParams?.priority).toBe('high')
      expect(capturedParams?.dueDate).toBe('2026-03-15')
      expect(capturedParams?.status).toBe('in-progress')
    })

    test('propagates API errors', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        createTask: mock(() => Promise.reject(new Error('API Error'))),
      }))

      const tool = makeCreateTaskTool(mockConfig)
      const promise = getToolExecutor(tool)({ title: 'Test', projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates required title parameter', async () => {
      const tool = makeCreateTaskTool(mockConfig)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeUpdateTaskTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeUpdateTaskTool(mockConfig)
      expect(tool.description).toContain("Update an existing Kaneo task's")
    })

    test('updates task with single field', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Updated Task',
            number: 42,
            status: 'done',
          }),
        ),
      }))

      const tool = makeUpdateTaskTool(mockConfig)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', status: 'done' },
        { toolCallId: '1', messages: [] },
      )
      if (!isTask(result)) throw new Error('Invalid result')

      expect(result.id).toBe('task-1')
      expect(result.number).toBe(42)
      expect(result.status).toBe('done')
    })

    test('updates task with multiple fields', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        updateTask: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'task-1',
            title: String(params.title),
            number: 42,
            status: String(params.status),
          })
        }),
      }))

      const tool = makeUpdateTaskTool(mockConfig)
      await tool.execute(
        { taskId: 'task-1', title: 'New Title', priority: 'high', dueDate: '2026-12-31' },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedParams?.taskId).toBe('task-1')
      expect(capturedParams?.title).toBe('New Title')
      expect(capturedParams?.priority).toBe('high')
      expect(capturedParams?.dueDate).toBe('2026-12-31')
    })

    test('propagates API errors including 404', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateTask: mock(() => {
          const error = Object.assign(new Error('Task not found'), { code: 'task-not-found' })
          return Promise.reject(error)
        }),
      }))

      const tool = makeUpdateTaskTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'invalid', status: 'done' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeUpdateTaskTool(mockConfig)
      const promise = getToolExecutor(tool)({ status: 'done' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeGetTaskTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeGetTaskTool(mockConfig)
      expect(tool.description).toContain('Fetch full details')
    })

    test('fetches task with details', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        getTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            number: 42,
            status: 'todo',
            priority: 'high',
            description: 'Task details',
            relations: [{ type: 'blocks', taskId: 'task-2' }],
          }),
        ),
      }))

      const tool = makeGetTaskTool(mockConfig)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      if (!isTaskWithRelations(result)) throw new Error('Invalid result')

      expect(result.id).toBe('task-1')
      expect(result.title).toBe('Test Task')
      expect(result.number).toBe(42)
      expect(result.relations).toHaveLength(1)
      expect(result.relations[0].type).toBe('blocks')
    })

    test('handles task with no relations', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        getTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            number: 42,
            status: 'todo',
            relations: [],
          }),
        ),
      }))

      const tool = makeGetTaskTool(mockConfig)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      if (!isTaskWithRelations(result)) throw new Error('Invalid result')

      expect(result.relations).toEqual([])
    })

    test('propagates task not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        getTask: mock(() => Promise.reject(new Error('Task not found'))),
      }))

      const tool = makeGetTaskTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'invalid' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeGetTaskTool(mockConfig)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeListTasksTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeListTasksTool(mockConfig)
      expect(tool.description).toContain('List all tasks')
    })

    test('lists tasks for project', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listTasks: mock(() =>
          Promise.resolve([
            { id: 'task-1', title: 'Task 1', number: 1, status: 'todo', priority: 'medium' },
            { id: 'task-2', title: 'Task 2', number: 2, status: 'done', priority: 'high' },
          ]),
        ),
      }))

      const tool = makeListTasksTool(mockConfig)
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isTaskArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(2)
      expect(result[0].title).toBe('Task 1')
      expect(result[1].title).toBe('Task 2')
    })

    test('returns empty array when no tasks', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listTasks: mock(() => Promise.resolve([])),
      }))

      const tool = makeListTasksTool(mockConfig)
      const result: unknown = await tool.execute({ projectId: 'empty-proj' }, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(0)
    })

    test('propagates project not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listTasks: mock(() => Promise.reject(new Error('Project not found'))),
      }))

      const tool = makeListTasksTool(mockConfig)
      const promise = getToolExecutor(tool)({ projectId: 'invalid' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', async () => {
      const tool = makeListTasksTool(mockConfig)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeSearchTasksTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeSearchTasksTool(mockConfig, mockWorkspaceId)
      expect(tool.description).toContain('Search for tasks')
    })

    test('searches tasks by keyword', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        searchTasks: mock(() =>
          Promise.resolve([
            { id: 'task-1', title: 'Fix bug', number: 1, status: 'todo', priority: 'high' },
            { id: 'task-2', title: 'Bug report', number: 2, status: 'done', priority: 'medium' },
          ]),
        ),
      }))

      const tool = makeSearchTasksTool(mockConfig, mockWorkspaceId)
      const result: unknown = await tool.execute({ query: 'bug' }, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(2)
    })

    test('includes workspaceId in search', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        searchTasks: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve([])
        }),
      }))

      const tool = makeSearchTasksTool(mockConfig, 'ws-123')
      await tool.execute({ query: 'test' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.workspaceId).toBe('ws-123')
      expect(capturedParams?.query).toBe('test')
    })

    test('filters by projectId when provided', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        searchTasks: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve([])
        }),
      }))

      const tool = makeSearchTasksTool(mockConfig, mockWorkspaceId)
      await tool.execute({ query: 'test', projectId: 'proj-1' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.query).toBe('test')
      expect(capturedParams?.projectId).toBe('proj-1')
    })

    test('returns empty array when no matches', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        searchTasks: mock(() => Promise.resolve([])),
      }))

      const tool = makeSearchTasksTool(mockConfig, mockWorkspaceId)
      const result: unknown = await tool.execute({ query: 'nonexistent' }, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toEqual([])
    })
  })

  describe('makeArchiveTaskTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeArchiveTaskTool(mockConfig, mockWorkspaceId)
      expect(tool.description).toContain('Archive a Kaneo task')
    })

    test('archives task successfully', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        archiveTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            status: 'archived',
          }),
        ),
      }))

      const tool = makeArchiveTaskTool(mockConfig, mockWorkspaceId)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      if (!isTask(result)) throw new Error('Invalid result')

      expect(result.id).toBe('task-1')
      expect(result.status).toBe('archived')
    })

    test('includes workspaceId in archive call', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        archiveTask: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({ id: 'task-1' })
        }),
      }))

      const tool = makeArchiveTaskTool(mockConfig, 'ws-123')
      await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.workspaceId).toBe('ws-123')
      expect(capturedParams?.taskId).toBe('task-1')
    })

    test('handles already archived task', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        archiveTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            status: 'archived',
          }),
        ),
      }))

      const tool = makeArchiveTaskTool(mockConfig, mockWorkspaceId)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      if (!isTask(result)) throw new Error('Invalid result')

      expect(result.id).toBe('task-1')
    })

    test('propagates task not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        archiveTask: mock(() => Promise.reject(new Error('Task not found'))),
      }))

      const tool = makeArchiveTaskTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({ taskId: 'invalid' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeArchiveTaskTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })
})
