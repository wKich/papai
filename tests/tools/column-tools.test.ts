import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeListColumnsTool } from '../../src/tools/list-columns.js'
import { getToolExecutor } from '../test-helpers.js'

const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

interface ColumnItem {
  id: string
  name: string
  position: number
}

function isColumnItem(item: unknown): item is ColumnItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    'id' in item &&
    typeof (item as Record<string, unknown>).id === 'string' &&
    'name' in item &&
    typeof (item as Record<string, unknown>).name === 'string' &&
    'position' in item &&
    typeof (item as Record<string, unknown>).position === 'number'
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
            { id: 'col-1', name: 'todo', position: 0 },
            { id: 'col-2', name: 'in-progress', position: 1 },
            { id: 'col-3', name: 'done', position: 2 },
          ]),
        ),
      }))

      const tool = makeListColumnsTool(mockConfig)
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isColumnArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(3)
      expect(result[0].name).toBe('todo')
      expect(result[1].name).toBe('in-progress')
      expect(result[2].name).toBe('done')
    })

    test('returns empty array when no columns', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listColumns: mock(() => Promise.resolve([])),
      }))

      const tool = makeListColumnsTool(mockConfig)
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
            { id: 'col-1', name: 'Backlog', position: 0 },
            { id: 'col-2', name: 'In Progress', position: 1 },
            { id: 'col-3', name: 'Review', position: 2 },
            { id: 'col-4', name: 'Done', position: 3 },
          ]),
        ),
      }))

      const tool = makeListColumnsTool(mockConfig)
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isColumnArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(4)
      for (const column of result) {
        expect(column).toHaveProperty('id')
        expect(column).toHaveProperty('name')
        expect(column).toHaveProperty('position')
        expect(typeof column.position).toBe('number')
      }
    })
  })
})
