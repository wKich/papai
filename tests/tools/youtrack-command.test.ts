import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeApplyYouTrackCommandTool } from '../../src/tools/apply-youtrack-command.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('apply_youtrack_command', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('requires query and taskIds', () => {
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const }))
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { query: 'for me', taskIds: ['TEST-1'] })).toBe(true)
    expect(schemaValidates(tool, { query: 'delete', taskIds: ['TEST-1'], confidence: 0.9 })).toBe(true)
    expect(schemaValidates(tool, { query: '   ', taskIds: ['TEST-1'] })).toBe(false)
    expect(schemaValidates(tool, { query: 'for me', taskIds: ['TEST-1', '   '] })).toBe(false)
  })

  test('forwards the command payload to the provider', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], silent: true }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))
    const result = await getToolExecutor(tool)({ query: 'for me', taskIds: ['TEST-1'], silent: true })
    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], silent: true })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: true,
    })
  })

  test('returns confirmation_required for delete commands without high confidence', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'delete', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('forwards delete commands after explicit confirmation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'delete', taskIds: ['TEST-1'], confidence: 1 })

    expect(result).toEqual({ query: 'delete', taskIds: ['TEST-1'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'delete',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: undefined,
    })
  })

  test('returns confirmation_required when delete appears later in the command', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'for me delete', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns confirmation_required for removal-style commands without high confidence', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'remove tag blocker', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'remove tag blocker', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })
})
