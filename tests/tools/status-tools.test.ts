import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeCreateStatusTool } from '../../src/tools/create-status.js'
import { makeDeleteStatusTool } from '../../src/tools/delete-status.js'
import { makeListStatusesTool } from '../../src/tools/list-statuses.js'
import { makeReorderStatusesTool } from '../../src/tools/reorder-statuses.js'
import { makeUpdateStatusTool } from '../../src/tools/update-status.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

interface StatusItem {
  id: string
  name: string
  color?: string | null
  isFinal?: boolean
}

function isStatusItem(item: unknown): item is StatusItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    'id' in item &&
    typeof (item as Record<string, unknown>)['id'] === 'string' &&
    'name' in item &&
    typeof (item as Record<string, unknown>)['name'] === 'string'
  )
}

function isStatusArray(val: unknown): val is StatusItem[] {
  return Array.isArray(val) && val.every(isStatusItem)
}

describe('Status Tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  describe('makeListStatusesTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeListStatusesTool(provider)
      expect(tool.description).toContain('List all statuses')
    })

    test('lists all statuses in project', async () => {
      const provider = createMockProvider({
        listStatuses: mock(() =>
          Promise.resolve([
            { id: 'col-1', name: 'todo' },
            { id: 'col-2', name: 'in-progress' },
            { id: 'col-3', name: 'done', isFinal: true },
          ]),
        ),
      })

      const tool = makeListStatusesTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isStatusArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(3)
      expect(result[0]?.name).toBe('todo')
      expect(result[1]?.name).toBe('in-progress')
      expect(result[2]?.name).toBe('done')
    })

    test('returns empty array when no statuses', async () => {
      const provider = createMockProvider({
        listStatuses: mock(() => Promise.resolve([])),
      })

      const tool = makeListStatusesTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'empty-proj' }, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(0)
    })

    test('includes projectId in list call', async () => {
      const listStatuses = mock((_projectId: string) => Promise.resolve([]))
      const provider = createMockProvider({ listStatuses })

      const tool = makeListStatusesTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ projectId: 'proj-123' }, { toolCallId: '1', messages: [] })

      expect(listStatuses).toHaveBeenCalledWith('proj-123')
    })

    test('propagates project not found error', async () => {
      const provider = createMockProvider({
        listStatuses: mock((): Promise<never> => Promise.reject(new Error('Project not found'))),
      })

      const tool = makeListStatusesTool(provider)
      const promise: Promise<unknown> = getToolExecutor(tool)(
        { projectId: 'invalid' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        listStatuses: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeListStatusesTool(provider)
      const promise: Promise<unknown> = getToolExecutor(tool)(
        { projectId: 'proj-1' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeListStatusesTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
    })

    test('returns statuses with correct structure', async () => {
      const provider = createMockProvider({
        listStatuses: mock(() =>
          Promise.resolve([
            { id: 'col-1', name: 'Backlog' },
            { id: 'col-2', name: 'In Progress' },
            { id: 'col-3', name: 'Review' },
            { id: 'col-4', name: 'Done', isFinal: true },
          ]),
        ),
      })

      const tool = makeListStatusesTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isStatusArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(4)
      for (const status of result) {
        expect(status).toHaveProperty('id')
        expect(status).toHaveProperty('name')
      }
    })
  })

  describe('makeCreateStatusTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeCreateStatusTool(provider)
      expect(tool.description).toContain('Create a new status')
    })

    test('creates status with required fields', async () => {
      const provider = createMockProvider({
        createStatus: mock(() =>
          Promise.resolve({
            id: 'col-new',
            name: 'In Progress',
          }),
        ),
      })

      const tool = makeCreateStatusTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { projectId: 'proj-1', name: 'In Progress' },
        { toolCallId: '1', messages: [] },
      )
      if (!isStatusItem(result)) throw new Error('Invalid result')

      expect(result.id).toBe('col-new')
      expect(result.name).toBe('In Progress')
    })

    test('creates status with all optional fields', async () => {
      const createStatus = mock(
        (_projectId: string, params: { name: string; icon?: string; color?: string; isFinal?: boolean }) =>
          Promise.resolve({
            id: 'col-new',
            name: params.name,
            isFinal: params.isFinal,
          }),
      )
      const provider = createMockProvider({ createStatus })

      const tool = makeCreateStatusTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute(
        { projectId: 'proj-1', name: 'Done', icon: 'check', color: '#00ff00', isFinal: true },
        { toolCallId: '1', messages: [] },
      )

      expect(createStatus).toHaveBeenCalledWith('proj-1', {
        name: 'Done',
        icon: 'check',
        color: '#00ff00',
        isFinal: true,
      })
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        createStatus: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeCreateStatusTool(provider)
      const promise = getToolExecutor(tool)({ projectId: 'proj-1', name: 'Test' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeCreateStatusTool(provider)
      expect(schemaValidates(tool, { name: 'Test' })).toBe(false)
    })

    test('validates name is required', () => {
      const provider = createMockProvider()
      const tool = makeCreateStatusTool(provider)
      expect(schemaValidates(tool, { projectId: 'proj-1' })).toBe(false)
    })
  })

  describe('makeUpdateStatusTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeUpdateStatusTool(provider)
      expect(tool.description).toContain('Update an existing status')
    })

    test('updates status name', async () => {
      const provider = createMockProvider({
        updateStatus: mock(() =>
          Promise.resolve({
            id: 'col-1',
            name: 'Updated Name',
          }),
        ),
      })

      const tool = makeUpdateStatusTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { statusId: 'col-1', name: 'Updated Name' },
        { toolCallId: '1', messages: [] },
      )
      if (!isStatusItem(result)) throw new Error('Invalid result')

      expect(result.id).toBe('col-1')
      expect(result.name).toBe('Updated Name')
    })

    test('updates status with multiple fields', async () => {
      const updateStatus = mock(
        (_statusId: string, params: { name?: string; icon?: string; color?: string; isFinal?: boolean }) =>
          Promise.resolve({
            id: 'col-1',
            name: params.name ?? 'Test',
            isFinal: params.isFinal,
          }),
      )
      const provider = createMockProvider({ updateStatus })

      const tool = makeUpdateStatusTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute(
        { statusId: 'col-1', name: 'Done', color: '#00ff00', isFinal: true },
        { toolCallId: '1', messages: [] },
      )

      expect(updateStatus).toHaveBeenCalledWith('col-1', {
        name: 'Done',
        icon: undefined,
        color: '#00ff00',
        isFinal: true,
      })
    })

    test('propagates status not found error', async () => {
      const provider = createMockProvider({
        updateStatus: mock(() => Promise.reject(new Error('Status not found'))),
      })

      const tool = makeUpdateStatusTool(provider)
      const promise = getToolExecutor(tool)({ statusId: 'invalid', name: 'Test' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Status not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates statusId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateStatusTool(provider)
      expect(schemaValidates(tool, { name: 'Test' })).toBe(false)
    })

    test('validates at least one field is provided', () => {
      const provider = createMockProvider()
      const tool = makeUpdateStatusTool(provider)
      expect(schemaValidates(tool, { statusId: 'col-1' })).toBe(false)
    })
  })

  describe('makeDeleteStatusTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeDeleteStatusTool(provider)
      expect(tool.description).toContain('Delete a status')
    })

    test('deletes status successfully with high confidence', async () => {
      const provider = createMockProvider({
        deleteStatus: mock(() => Promise.resolve({ id: 'col-1' })),
      })

      const execute = getToolExecutor(makeDeleteStatusTool(provider))
      const result: unknown = await execute({ statusId: 'col-1', confidence: 0.9 }, { toolCallId: '1', messages: [] })

      expect(result).toMatchObject({ id: 'col-1' })
    })

    test('returns confirmation_required when confidence is below threshold', async () => {
      const provider = createMockProvider()
      const execute = getToolExecutor(makeDeleteStatusTool(provider))
      const result: unknown = await execute(
        { statusId: 'col-1', label: 'In Progress', confidence: 0.6 },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({ status: 'confirmation_required' })
      if (typeof result === 'object' && result !== null && 'message' in result) {
        const message = (result as Record<string, unknown>)['message']
        expect(typeof message === 'string' && message.includes('In Progress')).toBe(true)
        expect(typeof message === 'string' && !message.includes('0.6')).toBe(true)
        expect(typeof message === 'string' && !message.includes('0.85')).toBe(true)
      } else {
        throw new Error('Expected result to have a message string')
      }
    })

    test('executes when confidence exactly meets threshold (0.85)', async () => {
      const provider = createMockProvider({
        deleteStatus: mock(() => Promise.resolve({ id: 'col-1' })),
      })

      const execute = getToolExecutor(makeDeleteStatusTool(provider))
      const result: unknown = await execute({ statusId: 'col-1', confidence: 0.85 }, { toolCallId: '1', messages: [] })

      expect(result).toMatchObject({ id: 'col-1' })
    })

    test('propagates status not found error', async () => {
      const provider = createMockProvider({
        deleteStatus: mock(() => Promise.reject(new Error('Status not found'))),
      })

      const tool = makeDeleteStatusTool(provider)
      const promise = getToolExecutor(tool)({ statusId: 'invalid', confidence: 0.9 }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Status not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates statusId is required', () => {
      const provider = createMockProvider()
      const tool = makeDeleteStatusTool(provider)
      expect(schemaValidates(tool, { confidence: 0.9 })).toBe(false)
    })
  })

  describe('makeReorderStatusesTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeReorderStatusesTool(provider)
      expect(tool.description).toContain('Reorder statuses')
    })

    test('reorders statuses successfully', async () => {
      const reorderStatuses = mock((_projectId: string, _statuses: { id: string; position: number }[]) =>
        Promise.resolve(),
      )
      const provider = createMockProvider({ reorderStatuses })

      const tool = makeReorderStatusesTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute(
        {
          projectId: 'proj-1',
          statuses: [
            { id: 'col-2', position: 0 },
            { id: 'col-1', position: 1 },
            { id: 'col-3', position: 2 },
          ],
        },
        { toolCallId: '1', messages: [] },
      )

      expect(reorderStatuses).toHaveBeenCalledWith('proj-1', [
        { id: 'col-2', position: 0 },
        { id: 'col-1', position: 1 },
        { id: 'col-3', position: 2 },
      ])
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        reorderStatuses: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeReorderStatusesTool(provider)
      const promise = getToolExecutor(tool)(
        {
          projectId: 'proj-1',
          statuses: [{ id: 'col-1', position: 0 }],
        },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeReorderStatusesTool(provider)
      expect(schemaValidates(tool, { statuses: [{ id: 'col-1', position: 0 }] })).toBe(false)
    })

    test('validates statuses is required', () => {
      const provider = createMockProvider()
      const tool = makeReorderStatusesTool(provider)
      expect(schemaValidates(tool, { projectId: 'proj-1' })).toBe(false)
    })

    test('reorderStatuses with empty statuses array', async () => {
      const reorderStatuses = mock((_projectId: string, _statuses: { id: string; position: number }[]) =>
        Promise.resolve(),
      )
      const provider = createMockProvider({ reorderStatuses })

      const tool = makeReorderStatusesTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { projectId: 'proj-1', statuses: [] },
        { toolCallId: '1', messages: [] },
      )

      expect(reorderStatuses).toHaveBeenCalledWith('proj-1', [])
      expect(result).toEqual({ success: true })
    })
  })
})
