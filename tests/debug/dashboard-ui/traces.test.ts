import { describe, expect, test } from 'bun:test'

import { buildTraceDetail } from '../../../src/debug/dashboard-ui/traces.js'

describe('traces', () => {
  test('buildTraceDetail exports function', () => {
    expect(typeof buildTraceDetail).toBe('function')
  })

  test('buildTraceDetail renders trace with tool calls', () => {
    const trace = {
      toolCalls: [{ toolName: 'test-tool', durationMs: 100, success: true }],
      totalTokens: { inputTokens: 100, outputTokens: 50 },
    }
    const html = buildTraceDetail(trace)
    expect(html).toContain('test-tool')
    expect(html).toContain('100ms')
    expect(html).toContain('in: 100')
    expect(html).toContain('out: 50')
  })

  test('buildTraceDetail renders trace with error', () => {
    const trace = {
      toolCalls: [],
      totalTokens: { inputTokens: 0, outputTokens: 0 },
      error: 'Something went wrong',
    }
    const html = buildTraceDetail(trace)
    expect(html).toContain('Something went wrong')
    expect(html).toContain('trace-error-msg')
  })
})
