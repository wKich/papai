import { describe, expect, test } from 'bun:test'

import { wrapToolExecution, type ToolErrorResult } from '../../src/tools/wrap-tool-execution.js'

describe('wrapToolExecution', () => {
  test('returns result when execution succeeds', async () => {
    const execute = (): Promise<{ success: boolean; data: string }> =>
      Promise.resolve({ success: true, data: 'result' })
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, { toolCallId: 'call-1', messages: [] })

    expect(result).toEqual({ success: true, data: 'result' })
  })

  test('returns structured error when execution throws', async () => {
    const execute = (): Promise<never> => Promise.reject(new Error('Something went wrong'))
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = (await wrapped({}, { toolCallId: 'call-1', messages: [] })) as ToolErrorResult

    // Validate the error result shape - must cast result because wrapToolExecution
    // returns Promise<unknown> for maximum compatibility
    expect(result.success).toBe(false)
    expect(result.error).toBe('Something went wrong')
    expect(result.toolName).toBe('test_tool')
    expect(result.toolCallId).toBe('call-1')
    expect(typeof result.timestamp).toBe('string')
  })
})
