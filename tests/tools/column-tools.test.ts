import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeCreateColumnTool } from '../../src/tools/create-column.js'
import { makeDeleteColumnTool } from '../../src/tools/delete-column.js'
import { makeListColumnsTool } from '../../src/tools/list-columns.js'
import { makeReorderColumnsTool } from '../../src/tools/reorder-columns.js'
import { makeUpdateColumnTool } from '../../src/tools/update-column.js'
import { getToolExecutor, schemaValidates } from '../test-helpers.js'
import { createMockProvider } from './mock-provider.js'

interface ColumnItem {
  id: string
  name: string
  color?: string | null
  isFinal?: boolean
}

function isColumnItem(item: unknown): item is ColumnItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    'id' in item &&
    typeof (item as Record<string, unknown>)['id'] === 'string' &&
    'name' in item &&
    typeof (item as Record<string, unknown>)['name'] === 'string'
  )
}

function isColumnArray(val: unknown): val is ColumnItem[] {
  return Array.isArray(val) && val.every(isColumnItem)
}

describe('Column Tools', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('makeListColumnsTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeListColumnsTool(provider)
      expect(tool.description).toContain('List all status columns')
    })

    test('lists all columns in project', async () => {
      const provider = createMockProvider({
        listColumns: mock(() =>
          Promise.resolve([
            { id: 'col-1', name: 'todo' },
            { id: 'col-2', name: 'in-progress' },
            { id: 'col-3', name: 'done', isFinal: true },
          ]),
        ),
      })

      const tool = makeListColumnsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isColumnArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(3)
      expect(result[0]?.name).toBe('todo')
      expect(result[1]?.name).toBe('in-progress')
      expect(result[2]?.name).toBe('done')
    })

    test('returns empty array when no columns', async () => {
      const provider = createMockProvider({
        listColumns: mock(() => Promise.resolve([])),
      })

      const tool = makeListColumnsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'empty-proj' }, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(0)
    })

    test('includes projectId in list call', async () => {
      const listColumns = mock((_projectId: string) => Promise.resolve([]))
      const provider = createMockProvider({ listColumns })

      const tool = makeListColumnsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ projectId: 'proj-123' }, { toolCallId: '1', messages: [] })

      expect(listColumns).toHaveBeenCalledWith('proj-123')
    })

    test('propagates project not found error', async () => {
      const provider = createMockProvider({
        listColumns: mock((): Promise<never> => Promise.reject(new Error('Project not found'))),
      })

      const tool = makeListColumnsTool(provider)
      const promise: Promise<unknown> = getToolExecutor(tool)(
        { projectId: 'invalid' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        listColumns: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeListColumnsTool(provider)
      const promise: Promise<unknown> = getToolExecutor(tool)(
        { projectId: 'proj-1' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeListColumnsTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
    })

    test('returns columns with correct structure', async () => {
      const provider = createMockProvider({
        listColumns: mock(() =>
          Promise.resolve([
            { id: 'col-1', name: 'Backlog' },
            { id: 'col-2', name: 'In Progress' },
            { id: 'col-3', name: 'Review' },
            { id: 'col-4', name: 'Done', isFinal: true },
          ]),
        ),
      })

      const tool = makeListColumnsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isColumnArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(4)
      for (const column of result) {
        expect(column).toHaveProperty('id')
        expect(column).toHaveProperty('name')
      }
    })
  })

  describe('makeCreateColumnTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeCreateColumnTool(provider)
      expect(tool.description).toContain('Create a new status column')
    })

    test('creates column with required fields', async () => {
      const provider = createMockProvider({
        createColumn: mock(() =>
          Promise.resolve({
            id: 'col-new',
            name: 'In Progress',
          }),
        ),
      })

      const tool = makeCreateColumnTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { projectId: 'proj-1', name: 'In Progress' },
        { toolCallId: '1', messages: [] },
      )
      if (!isColumnItem(result)) throw new Error('Invalid result')

      expect(result.id).toBe('col-new')
      expect(result.name).toBe('In Progress')
    })

    test('creates column with all optional fields', async () => {
      const createColumn = mock(
        (_projectId: string, params: { name: string; icon?: string; color?: string; isFinal?: boolean }) =>
          Promise.resolve({
            id: 'col-new',
            name: params.name,
            isFinal: params.isFinal,
          }),
      )
      const provider = createMockProvider({ createColumn })

      const tool = makeCreateColumnTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute(
        { projectId: 'proj-1', name: 'Done', icon: 'check', color: '#00ff00', isFinal: true },
        { toolCallId: '1', messages: [] },
      )

      expect(createColumn).toHaveBeenCalledWith('proj-1', {
        name: 'Done',
        icon: 'check',
        color: '#00ff00',
        isFinal: true,
      })
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        createColumn: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeCreateColumnTool(provider)
      const promise = getToolExecutor(tool)({ projectId: 'proj-1', name: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeCreateColumnTool(provider)
      expect(schemaValidates(tool, { name: 'Test' })).toBe(false)
    })

    test('validates name is required', () => {
      const provider = createMockProvider()
      const tool = makeCreateColumnTool(provider)
      expect(schemaValidates(tool, { projectId: 'proj-1' })).toBe(false)
    })
  })

  describe('makeUpdateColumnTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeUpdateColumnTool(provider)
      expect(tool.description).toContain('Update an existing status column')
    })

    test('updates column name', async () => {
      const provider = createMockProvider({
        updateColumn: mock(() =>
          Promise.resolve({
            id: 'col-1',
            name: 'Updated Name',
          }),
        ),
      })

      const tool = makeUpdateColumnTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { columnId: 'col-1', name: 'Updated Name' },
        { toolCallId: '1', messages: [] },
      )
      if (!isColumnItem(result)) throw new Error('Invalid result')

      expect(result.id).toBe('col-1')
      expect(result.name).toBe('Updated Name')
    })

    test('updates column with multiple fields', async () => {
      const updateColumn = mock(
        (_columnId: string, params: { name?: string; icon?: string; color?: string; isFinal?: boolean }) =>
          Promise.resolve({
            id: 'col-1',
            name: params.name ?? 'Test',
            isFinal: params.isFinal,
          }),
      )
      const provider = createMockProvider({ updateColumn })

      const tool = makeUpdateColumnTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute(
        { columnId: 'col-1', name: 'Done', color: '#00ff00', isFinal: true },
        { toolCallId: '1', messages: [] },
      )

      expect(updateColumn).toHaveBeenCalledWith('col-1', {
        name: 'Done',
        icon: undefined,
        color: '#00ff00',
        isFinal: true,
      })
    })

    test('propagates column not found error', async () => {
      const provider = createMockProvider({
        updateColumn: mock(() => Promise.reject(new Error('Column not found'))),
      })

      const tool = makeUpdateColumnTool(provider)
      const promise = getToolExecutor(tool)({ columnId: 'invalid', name: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Column not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates columnId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateColumnTool(provider)
      expect(schemaValidates(tool, { name: 'Test' })).toBe(false)
    })

    test('validates at least one field is provided', () => {
      const provider = createMockProvider()
      const tool = makeUpdateColumnTool(provider)
      expect(schemaValidates(tool, { columnId: 'col-1' })).toBe(false)
    })
  })

  describe('makeDeleteColumnTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeDeleteColumnTool(provider)
      expect(tool.description).toContain('Delete a status column')
    })

    test('deletes column successfully with high confidence', async () => {
      const provider = createMockProvider({
        deleteColumn: mock(() => Promise.resolve({ id: 'col-1' })),
      })

      const execute = getToolExecutor(makeDeleteColumnTool(provider))
      const result: unknown = await execute({ columnId: 'col-1', confidence: 0.9 }, { toolCallId: '1', messages: [] })

      expect(result).toMatchObject({ id: 'col-1' })
    })

    test('returns confirmation_required when confidence is below threshold', async () => {
      const provider = createMockProvider()
      const execute = getToolExecutor(makeDeleteColumnTool(provider))
      const result: unknown = await execute(
        { columnId: 'col-1', label: 'In Progress', confidence: 0.6 },
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
        deleteColumn: mock(() => Promise.resolve({ id: 'col-1' })),
      })

      const execute = getToolExecutor(makeDeleteColumnTool(provider))
      const result: unknown = await execute({ columnId: 'col-1', confidence: 0.85 }, { toolCallId: '1', messages: [] })

      expect(result).toMatchObject({ id: 'col-1' })
    })

    test('propagates column not found error', async () => {
      const provider = createMockProvider({
        deleteColumn: mock(() => Promise.reject(new Error('Column not found'))),
      })

      const tool = makeDeleteColumnTool(provider)
      const promise = getToolExecutor(tool)({ columnId: 'invalid', confidence: 0.9 }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Column not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates columnId is required', () => {
      const provider = createMockProvider()
      const tool = makeDeleteColumnTool(provider)
      expect(schemaValidates(tool, { confidence: 0.9 })).toBe(false)
    })
  })

  describe('makeReorderColumnsTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeReorderColumnsTool(provider)
      expect(tool.description).toContain('Reorder status columns')
    })

    test('reorders columns successfully', async () => {
      const reorderColumns = mock((_projectId: string, _columns: { id: string; position: number }[]) =>
        Promise.resolve(),
      )
      const provider = createMockProvider({ reorderColumns })

      const tool = makeReorderColumnsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute(
        {
          projectId: 'proj-1',
          columns: [
            { id: 'col-2', position: 0 },
            { id: 'col-1', position: 1 },
            { id: 'col-3', position: 2 },
          ],
        },
        { toolCallId: '1', messages: [] },
      )

      expect(reorderColumns).toHaveBeenCalledWith('proj-1', [
        { id: 'col-2', position: 0 },
        { id: 'col-1', position: 1 },
        { id: 'col-3', position: 2 },
      ])
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        reorderColumns: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeReorderColumnsTool(provider)
      const promise = getToolExecutor(tool)(
        {
          projectId: 'proj-1',
          columns: [{ id: 'col-1', position: 0 }],
        },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeReorderColumnsTool(provider)
      expect(schemaValidates(tool, { columns: [{ id: 'col-1', position: 0 }] })).toBe(false)
    })

    test('validates columns is required', () => {
      const provider = createMockProvider()
      const tool = makeReorderColumnsTool(provider)
      expect(schemaValidates(tool, { projectId: 'proj-1' })).toBe(false)
    })
  })
})
