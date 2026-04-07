import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeCreateLabelTool } from '../../src/tools/create-label.js'
import { makeListLabelsTool } from '../../src/tools/list-labels.js'
import { makeRemoveLabelTool } from '../../src/tools/remove-label.js'
import { makeUpdateLabelTool } from '../../src/tools/update-label.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

interface Label {
  id: string
  name: string
  color?: string
}

function isLabel(val: unknown): val is Label {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof (val as Record<string, unknown>)['id'] === 'string' &&
    'name' in val &&
    typeof (val as Record<string, unknown>)['name'] === 'string'
  )
}

function isLabelArray(val: unknown): val is Label[] {
  return Array.isArray(val) && val.every(isLabel)
}

describe('Label Tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  describe('makeListLabelsTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeListLabelsTool(provider)
      expect(tool.description).toContain('List all available labels')
    })

    test('lists all labels in workspace', async () => {
      const provider = createMockProvider({
        listLabels: mock(() =>
          Promise.resolve([
            { id: 'label-1', name: 'bug', color: '#ff0000' },
            { id: 'label-2', name: 'feature', color: '#00ff00' },
            { id: 'label-3', name: 'urgent', color: '#ff00ff' },
          ]),
        ),
      })

      const tool = makeListLabelsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })
      if (!isLabelArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(3)
      expect(result[0]?.['name']).toBe('bug')
      expect(result[1]?.['name']).toBe('feature')
    })

    test('returns empty array when no labels', async () => {
      const provider = createMockProvider({
        listLabels: mock(() => Promise.resolve([])),
      })

      const tool = makeListLabelsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(0)
    })

    test('calls provider listLabels', async () => {
      const listLabels = mock(() => Promise.resolve([]))
      const provider = createMockProvider({ listLabels })

      const tool = makeListLabelsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({}, { toolCallId: '1', messages: [] })

      expect(listLabels).toHaveBeenCalledTimes(1)
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        listLabels: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeListLabelsTool(provider)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeCreateLabelTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeCreateLabelTool(provider)
      expect(tool.description).toContain('Create a new label')
    })

    test('creates label with required name', async () => {
      const provider = createMockProvider({
        createLabel: mock(() =>
          Promise.resolve({
            id: 'label-1',
            name: 'new-label',
            color: '#6b7280',
          }),
        ),
      })

      const tool = makeCreateLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ name: 'new-label' }, { toolCallId: '1', messages: [] })
      if (!isLabel(result)) throw new Error('Invalid result')

      expect(result['id']).toBe('label-1')
      expect(result['name']).toBe('new-label')
      expect(result['color']).toBe('#6b7280')
    })

    test('creates label with custom color', async () => {
      const createLabel = mock((params: { name: string; color?: string }) =>
        Promise.resolve({
          id: 'label-1',
          name: params.name,
          color: params.color,
        }),
      )
      const provider = createMockProvider({ createLabel })

      const tool = makeCreateLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ name: 'urgent', color: '#ff0000' }, { toolCallId: '1', messages: [] })

      expect(createLabel).toHaveBeenCalledWith({ name: 'urgent', color: '#ff0000' })
    })

    test('passes undefined color when not provided', async () => {
      const createLabel = mock((params: { name: string; color?: string }) =>
        Promise.resolve({
          id: 'label-1',
          name: params.name,
        }),
      )
      const provider = createMockProvider({ createLabel })

      const tool = makeCreateLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ name: 'test-label' }, { toolCallId: '1', messages: [] })

      expect(createLabel).toHaveBeenCalledWith({ name: 'test-label', color: undefined })
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        createLabel: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeCreateLabelTool(provider)
      const promise = getToolExecutor(tool)({ name: 'Test' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates name is required', () => {
      const provider = createMockProvider()
      const tool = makeCreateLabelTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
    })
  })

  describe('makeUpdateLabelTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeUpdateLabelTool(provider)
      expect(tool.description).toContain('Update an existing label')
    })

    test('updates label name', async () => {
      const provider = createMockProvider({
        updateLabel: mock(() =>
          Promise.resolve({
            id: 'label-1',
            name: 'Updated Name',
            color: '#ff0000',
          }),
        ),
      })

      const tool = makeUpdateLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { labelId: 'label-1', name: 'Updated Name' },
        { toolCallId: '1', messages: [] },
      )
      if (!isLabel(result)) throw new Error('Invalid result')

      expect(result['id']).toBe('label-1')
      expect(result['name']).toBe('Updated Name')
    })

    test('updates label color', async () => {
      const updateLabel = mock((_labelId: string, params: { name?: string; color?: string }) =>
        Promise.resolve({
          id: 'label-1',
          name: 'test',
          color: params.color,
        }),
      )
      const provider = createMockProvider({ updateLabel })

      const tool = makeUpdateLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ labelId: 'label-1', color: '#00ff00' }, { toolCallId: '1', messages: [] })

      expect(updateLabel).toHaveBeenCalledWith('label-1', { name: undefined, color: '#00ff00' })
    })

    test('updates both name and color', async () => {
      const updateLabel = mock((_labelId: string, params: { name?: string; color?: string }) =>
        Promise.resolve({
          id: 'label-1',
          name: params.name ?? 'test',
          color: params.color,
        }),
      )
      const provider = createMockProvider({ updateLabel })

      const tool = makeUpdateLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ labelId: 'label-1', name: 'New Name', color: '#0000ff' }, { toolCallId: '1', messages: [] })

      expect(updateLabel).toHaveBeenCalledWith('label-1', { name: 'New Name', color: '#0000ff' })
    })

    test('propagates label not found error', async () => {
      const provider = createMockProvider({
        updateLabel: mock(() => Promise.reject(new Error('Label not found'))),
      })

      const tool = makeUpdateLabelTool(provider)
      const promise = getToolExecutor(tool)({ labelId: 'invalid', name: 'Test' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates labelId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateLabelTool(provider)
      expect(schemaValidates(tool, { name: 'Test' })).toBe(false)
    })

    test('validates at least one field is provided', () => {
      const provider = createMockProvider()
      const tool = makeUpdateLabelTool(provider)
      expect(schemaValidates(tool, { labelId: 'label-1' })).toBe(false)
    })
  })

  describe('makeRemoveLabelTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeRemoveLabelTool(provider)
      expect(tool.description).toContain('Remove (delete) a label')
    })

    test('removes label successfully with high confidence', async () => {
      const provider = createMockProvider({
        removeLabel: mock(() => Promise.resolve({ id: 'label-1' })),
      })

      const tool = makeRemoveLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { labelId: 'label-1', confidence: 0.9 },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({ id: 'label-1' })
    })

    test('returns confirmation_required when confidence is below threshold', async () => {
      const provider = createMockProvider()
      const tool = makeRemoveLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { labelId: 'label-1', label: 'urgent', confidence: 0.5 },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({ status: 'confirmation_required' })
      if (typeof result === 'object' && result !== null && 'message' in result) {
        const message = (result as Record<string, unknown>)['message']
        expect(typeof message === 'string' && message.includes('urgent')).toBe(true)
        expect(typeof message === 'string' && !message.includes('0.5')).toBe(true)
        expect(typeof message === 'string' && !message.includes('0.85')).toBe(true)
      } else {
        throw new Error('Expected result to have a message string')
      }
    })

    test('executes when confidence exactly meets threshold (0.85)', async () => {
      const provider = createMockProvider({
        removeLabel: mock(() => Promise.resolve({ id: 'label-1' })),
      })

      const tool = makeRemoveLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { labelId: 'label-1', confidence: 0.85 },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({ id: 'label-1' })
    })

    test('propagates label not found error', async () => {
      const provider = createMockProvider({
        removeLabel: mock(() => Promise.reject(new Error('Label not found'))),
      })

      const tool = makeRemoveLabelTool(provider)
      const promise = getToolExecutor(tool)({ labelId: 'invalid', confidence: 0.9 }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates labelId is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveLabelTool(provider)
      expect(schemaValidates(tool, { confidence: 0.9 })).toBe(false)
    })
  })
})
