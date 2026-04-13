import { describe, expect, test } from 'bun:test'

import { isToolErrorResult, wrapToolExecution } from '../../src/tools/wrap-tool-execution.js'

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

    const result = await wrapped({}, { toolCallId: 'call-1', messages: [] })

    // Use type guard to validate and narrow the result type
    expect(isToolErrorResult(result)).toBe(true)
    if (isToolErrorResult(result)) {
      expect(result.success).toBe(false)
      expect(result.error).toBe('Something went wrong')
      expect(result.toolName).toBe('test_tool')
      expect(result.toolCallId).toBe('call-1')
      expect(typeof result.timestamp).toBe('string')
    }
  })
})
