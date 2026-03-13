import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeDeleteColumnTool } from '../../src/tools/delete-column.js'
import { makeListColumnsTool } from '../../src/tools/list-columns.js'
import { getToolExecutor } from '../test-helpers.js'

const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

interface ColumnItem {
  id: string
  name: string
  color: string | null
  isFinal: boolean
}

function isColumnItem(item: unknown): item is ColumnItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    'id' in item &&
    typeof (item as Record<string, unknown>)['id'] === 'string' &&
    'name' in item &&
    typeof (item as Record<string, unknown>)['name'] === 'string' &&
    'isFinal' in item &&
    typeof (item as Record<string, unknown>)['isFinal'] === 'boolean'
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
      const tool = makeListColumnsTool(mockConfig)
      expect(tool.description).toContain('List all status columns')
    })

    test('lists all columns in project', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listColumns: mock(() =>
          Promise.resolve([
            { id: 'col-1', name: 'todo', color: null, isFinal: false },
            { id: 'col-2', name: 'in-progress', color: '#aaa', isFinal: false },
            { id: 'col-3', name: 'done', color: '#0f0', isFinal: true },
          ]),
        ),
      }))

      const tool = makeListColumnsTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isColumnArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(3)
      expect(result[0]?.name).toBe('todo')
      expect(result[1]?.name).toBe('in-progress')
      expect(result[2]?.name).toBe('done')
      expect(result[2]?.isFinal).toBe(true)
    })

    test('returns empty array when no columns', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listColumns: mock(() => Promise.resolve([])),
      }))

      const tool = makeListColumnsTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'empty-proj' }, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(0)
    })

    test('includes projectId in list call', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        listColumns: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve([])
        }),
      }))

      const tool = makeListColumnsTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ projectId: 'proj-123' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.['projectId']).toBe('proj-123')
    })

    test('propagates project not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listColumns: mock((): Promise<never> => Promise.reject(new Error('Project not found'))),
      }))

      const tool = makeListColumnsTool(mockConfig)
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
      await mock.module('../../src/kaneo/index.js', () => ({
        listColumns: mock(() => Promise.reject(new Error('API Error'))),
      }))

      const tool = makeListColumnsTool(mockConfig)
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

    test('validates projectId is required', async () => {
      const tool = makeListColumnsTool(mockConfig)
      const promise: Promise<unknown> = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('returns columns with correct structure', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listColumns: mock(() =>
          Promise.resolve([
            { id: 'col-1', name: 'Backlog', color: null, isFinal: false },
            { id: 'col-2', name: 'In Progress', color: '#aaa', isFinal: false },
            { id: 'col-3', name: 'Review', color: '#ff0', isFinal: false },
            { id: 'col-4', name: 'Done', color: '#0f0', isFinal: true },
          ]),
        ),
      }))

      const tool = makeListColumnsTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isColumnArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(4)
      for (const column of result) {
        expect(column).toHaveProperty('id')
        expect(column).toHaveProperty('name')
        expect(column).toHaveProperty('isFinal')
        expect(typeof column.isFinal).toBe('boolean')
      }
    })
  })

  describe('makeDeleteColumnTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeDeleteColumnTool(mockConfig)
      expect(tool.description).toContain('Delete a status column')
    })

    test('deletes column successfully with high confidence', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        deleteColumn: mock(() => Promise.resolve({ success: true })),
      }))

      const execute = getToolExecutor(makeDeleteColumnTool(mockConfig))
      const result: unknown = await execute({ columnId: 'col-1', confidence: 0.9 }, { toolCallId: '1', messages: [] })

      expect(result).toMatchObject({ success: true })
    })

    test('returns confirmation_required when confidence is below threshold', async () => {
      const execute = getToolExecutor(makeDeleteColumnTool(mockConfig))
      const result: unknown = await execute(
        { columnId: 'col-1', label: 'In Progress', confidence: 0.6 },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({ status: 'confirmation_required' })
      expect((result as { message: string }).message).toContain('In Progress')
      expect((result as { message: string }).message).not.toContain('0.6')
      expect((result as { message: string }).message).not.toContain('0.85')
    })

    test('executes when confidence exactly meets threshold (0.85)', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        deleteColumn: mock(() => Promise.resolve({ success: true })),
      }))

      const execute = getToolExecutor(makeDeleteColumnTool(mockConfig))
      const result: unknown = await execute({ columnId: 'col-1', confidence: 0.85 }, { toolCallId: '1', messages: [] })

      expect(result).toMatchObject({ success: true })
    })

    test('propagates column not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        deleteColumn: mock(() => Promise.reject(new Error('Column not found'))),
      }))

      const tool = makeDeleteColumnTool(mockConfig)
      const promise = getToolExecutor(tool)({ columnId: 'invalid', confidence: 0.9 }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Column not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates columnId is required', () => {
      const tool = makeDeleteColumnTool(mockConfig)
      const schema = tool.inputSchema as { safeParse: (v: unknown) => { success: boolean } }
      expect(schema.safeParse({ confidence: 0.9 }).success).toBe(false)
    })
  })
})
