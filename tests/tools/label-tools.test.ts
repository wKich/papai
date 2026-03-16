import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeCreateLabelTool } from '../../src/tools/create-label.js'
import { makeListLabelsTool } from '../../src/tools/list-labels.js'
import { makeRemoveLabelTool } from '../../src/tools/remove-label.js'
import { makeUpdateLabelTool } from '../../src/tools/update-label.js'
import { getToolExecutor } from '../test-helpers.js'

const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }
const mockWorkspaceId = 'ws-1'

interface LabelItem {
  id: string
  name: string
  color: string
}

function isLabelItem(item: unknown): item is LabelItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    'id' in item &&
    typeof (item as Record<string, unknown>)['id'] === 'string' &&
    'name' in item &&
    typeof (item as Record<string, unknown>)['name'] === 'string' &&
    'color' in item &&
    typeof (item as Record<string, unknown>)['color'] === 'string'
  )
}

function isLabelArray(val: unknown): val is LabelItem[] {
  return Array.isArray(val) && val.every(isLabelItem)
}

function isLabel(val: unknown): val is LabelItem {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof (val as Record<string, unknown>)['id'] === 'string' &&
    'name' in val &&
    typeof (val as Record<string, unknown>)['name'] === 'string' &&
    'color' in val &&
    typeof (val as Record<string, unknown>)['color'] === 'string'
  )
}

function isSuccessResult(val: unknown): val is { success: boolean } {
  return val !== null && typeof val === 'object' && 'success' in val && typeof val.success === 'boolean'
}

describe('Label Tools', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('makeListLabelsTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeListLabelsTool(mockConfig, mockWorkspaceId)
      expect(tool.description).toContain('List all available labels')
    })

    test('lists all labels in workspace', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listLabels: mock(() =>
          Promise.resolve([
            { id: 'label-1', name: 'bug', color: '#ff0000' },
            { id: 'label-2', name: 'feature', color: '#00ff00' },
            { id: 'label-3', name: 'urgent', color: '#ff00ff' },
          ]),
        ),
      }))

      const tool = makeListLabelsTool(mockConfig, mockWorkspaceId)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })
      if (!isLabelArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(3)
      expect(result[0]?.['name']).toBe('bug')
      expect(result[1]?.['name']).toBe('feature')
    })

    test('returns empty array when no labels', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listLabels: mock(() => Promise.resolve([])),
      }))

      const tool = makeListLabelsTool(mockConfig, mockWorkspaceId)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(0)
    })

    test('includes workspaceId in list call', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        listLabels: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve([])
        }),
      }))

      const tool = makeListLabelsTool(mockConfig, 'ws-123')
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({}, { toolCallId: '1', messages: [] })

      expect(capturedParams?.['workspaceId']).toBe('ws-123')
    })

    test('propagates API errors', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listLabels: mock(() => Promise.reject(new Error('API Error'))),
      }))

      const tool = makeListLabelsTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeCreateLabelTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeCreateLabelTool(mockConfig, mockWorkspaceId)
      expect(tool.description).toContain('Create a new label')
    })

    test('creates label with required name', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        createLabel: mock(() =>
          Promise.resolve({
            id: 'label-1',
            name: 'new-label',
            color: '#6b7280',
          }),
        ),
      }))

      const tool = makeCreateLabelTool(mockConfig, mockWorkspaceId)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ name: 'new-label' }, { toolCallId: '1', messages: [] })
      if (!isLabel(result)) throw new Error('Invalid result')

      expect(result['id']).toBe('label-1')
      expect(result['name']).toBe('new-label')
      expect(result['color']).toBe('#6b7280')
    })

    test('creates label with custom color', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        createLabel: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'label-1',
            name: String(params['name']),
            color: String(params['color']),
          })
        }),
      }))

      const tool = makeCreateLabelTool(mockConfig, mockWorkspaceId)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ name: 'urgent', color: '#ff0000' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.['name']).toBe('urgent')
      expect(capturedParams?.['color']).toBe('#ff0000')
    })

    test('passes undefined color when not provided', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        createLabel: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'label-1',
            name: String(params['name']),
            color: '#6b7280',
          })
        }),
      }))

      const tool = makeCreateLabelTool(mockConfig, mockWorkspaceId)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ name: 'test-label' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.['name']).toBe('test-label')
      expect(capturedParams?.['color']).toBeUndefined()
    })

    test('includes workspaceId in create call', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        createLabel: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({ id: 'label-1', name: 'test', color: '#000' })
        }),
      }))

      const tool = makeCreateLabelTool(mockConfig, 'ws-123')
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ name: 'test' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.['workspaceId']).toBe('ws-123')
    })

    test('propagates API errors', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        createLabel: mock(() => Promise.reject(new Error('API Error'))),
      }))

      const tool = makeCreateLabelTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({ name: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates name is required', async () => {
      const tool = makeCreateLabelTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeUpdateLabelTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeUpdateLabelTool(mockConfig)
      expect(tool.description).toContain('Update an existing Kaneo label')
    })

    test('updates label name', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateLabel: mock(() =>
          Promise.resolve({
            id: 'label-1',
            name: 'Updated Name',
            color: '#ff0000',
          }),
        ),
      }))

      const tool = makeUpdateLabelTool(mockConfig)
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
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        updateLabel: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'label-1',
            name: 'test',
            color: String(params['color']),
          })
        }),
      }))

      const tool = makeUpdateLabelTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ labelId: 'label-1', color: '#00ff00' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.['color']).toBe('#00ff00')
    })

    test('updates both name and color', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        updateLabel: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'label-1',
            name: String(params['name']),
            color: String(params['color']),
          })
        }),
      }))

      const tool = makeUpdateLabelTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ labelId: 'label-1', name: 'New Name', color: '#0000ff' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.['name']).toBe('New Name')
      expect(capturedParams?.['color']).toBe('#0000ff')
    })

    test('propagates label not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateLabel: mock(() => Promise.reject(new Error('Label not found'))),
      }))

      const tool = makeUpdateLabelTool(mockConfig)
      const promise = getToolExecutor(tool)({ labelId: 'invalid', name: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates labelId is required', async () => {
      const tool = makeUpdateLabelTool(mockConfig)
      const promise = getToolExecutor(tool)({ name: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates at least one field is provided', async () => {
      const tool = makeUpdateLabelTool(mockConfig)
      const promise = getToolExecutor(tool)({ labelId: 'label-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeRemoveLabelTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeRemoveLabelTool(mockConfig)
      expect(tool.description).toContain('Remove (delete) a Kaneo label')
    })

    test('removes label successfully with high confidence', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeLabel: mock(() => Promise.resolve({ success: true })),
      }))

      const tool = makeRemoveLabelTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { labelId: 'label-1', confidence: 0.9 },
        { toolCallId: '1', messages: [] },
      )
      if (!isSuccessResult(result)) throw new Error('Invalid result')

      expect(result.success).toBe(true)
    })

    test('returns confirmation_required when confidence is below threshold', async () => {
      const tool = makeRemoveLabelTool(mockConfig)
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
      await mock.module('../../src/kaneo/index.js', () => ({
        removeLabel: mock(() => Promise.resolve({ success: true })),
      }))

      const tool = makeRemoveLabelTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { labelId: 'label-1', confidence: 0.85 },
        { toolCallId: '1', messages: [] },
      )
      if (!isSuccessResult(result)) throw new Error('Invalid result')

      expect(result.success).toBe(true)
    })

    test('propagates label not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeLabel: mock(() => Promise.reject(new Error('Label not found'))),
      }))

      const tool = makeRemoveLabelTool(mockConfig)
      const promise = getToolExecutor(tool)({ labelId: 'invalid', confidence: 0.9 }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates labelId is required', () => {
      const tool = makeRemoveLabelTool(mockConfig)
      const schema = tool.inputSchema
      expect(typeof schema === 'object' && schema !== null && 'safeParse' in schema).toBe(true)
      if (
        typeof schema === 'object' &&
        schema !== null &&
        'safeParse' in schema &&
        typeof schema.safeParse === 'function'
      ) {
        const parseResult = schema.safeParse({ confidence: 0.9 })
        expect(
          typeof parseResult === 'object' && parseResult !== null && 'success' in parseResult && parseResult.success,
        ).toBe(false)
      }
    })
  })
})
