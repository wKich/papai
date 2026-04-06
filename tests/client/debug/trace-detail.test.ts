import { describe, expect, test } from 'bun:test'

import type { LlmTrace } from '../../../src/debug/schemas.js'

describe('trace-detail types', () => {
  test('LlmTrace type accepts all expected fields', () => {
    const trace: LlmTrace = {
      timestamp: Date.now(),
      userId: 'user-123',
      model: 'gpt-4',
      duration: 2500,
      steps: 3,
      totalTokens: { inputTokens: 150, outputTokens: 250 },
      toolCalls: [
        {
          toolName: 'create_task',
          durationMs: 500,
          success: true,
          toolCallId: 'call-1',
          args: { title: 'Test' },
          result: { id: 'task-123' },
        },
      ],
      responseId: 'resp-123',
      actualModel: 'gpt-4-0125-preview',
      finishReason: 'stop',
      messageCount: 5,
      toolCount: 10,
      generatedText: 'Hello!',
      stepsDetail: [
        {
          stepNumber: 1,
          toolCalls: [{ toolName: 'search', toolCallId: 'call-1', args: {} }],
          usage: { inputTokens: 50, outputTokens: 30 },
        },
      ],
    }

    expect(trace.model).toBe('gpt-4')
    expect(trace.toolCalls).toHaveLength(1)
    expect(trace.stepsDetail).toHaveLength(1)
    expect(trace.generatedText).toBe('Hello!')
  })
})
