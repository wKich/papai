import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeApplyYouTrackCommandTool } from '../../src/tools/apply-youtrack-command.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const expectConfirmationMessage = (result: unknown, text: string): void => {
  expect(result).toMatchObject({ status: 'confirmation_required' })
  expect(result).toBeObject()
  if (result === null || typeof result !== 'object' || !('message' in result) || typeof result.message !== 'string') {
    expect.unreachable('Expected confirmation result with a message string')
  }
  expect(result.message).toContain(text)
}

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

  test('forwards the command payload to the provider after explicit confirmation for side effects', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], silent: true }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))
    const result = await getToolExecutor(tool)({ query: 'for me', taskIds: ['TEST-1'], silent: true, confidence: 1 })
    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], silent: true })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: true,
    })
  })

  test('returns confirmation_required for commands outside the safe allowlist without high confidence', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'State In Progress', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'State In Progress', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('forwards commands outside the safe allowlist after explicit confirmation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'State In Progress', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'State In Progress', taskIds: ['TEST-1'], confidence: 1 })

    expect(result).toEqual({ query: 'State In Progress', taskIds: ['TEST-1'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'State In Progress',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: undefined,
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

  test('returns confirmation_required when tag is followed by another operation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'tag blocker delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'tag blocker delete',
      taskIds: ['TEST-1'],
      confidence: 0.6,
    })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns confirmation_required when untag is followed by another operation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'untag blocker delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'untag blocker delete',
      taskIds: ['TEST-1'],
      confidence: 0.6,
    })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns confirmation_required when comment is combined with another operation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'comment delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'comment delete',
      taskIds: ['TEST-1'],
      comment: 'Investigating now',
      confidence: 0.6,
    })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('allows known-safe for-me commands without confirmation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'for me', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: undefined,
    })
  })

  test('requires confirmation when a safe command also adds a comment', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], comment: 'On it' }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: 'On it',
      confidence: 0.6,
    })

    expectConfirmationMessage(result, 'with a comment')
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('requires confirmation when a safe command runs silently', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'vote', taskIds: ['TEST-1'], silent: true }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'vote',
      taskIds: ['TEST-1'],
      silent: true,
      confidence: 0.6,
    })

    expectConfirmationMessage(result, 'without notifications')
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('forwards a confirmed command that adds a comment', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], comment: 'On it' }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: 'On it',
      confidence: 1,
    })

    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], comment: 'On it' })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: 'On it',
      silent: undefined,
    })
  })

  test('allows exact single-user for commands without confirmation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for jane.doe', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'for jane.doe', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toEqual({ query: 'for jane.doe', taskIds: ['TEST-1'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for jane.doe',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: undefined,
    })
  })
})
