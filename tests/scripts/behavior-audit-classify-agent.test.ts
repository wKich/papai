import { afterEach, describe, expect, mock, test } from 'bun:test'

import { createReportsConfig } from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir } from './behavior-audit-integration.runtime-helpers.js'
import { loadClassifyAgentModule, type MockClassificationResult } from './behavior-audit-integration.support.js'

function isCallableTimerHandler(value: TimerHandler): value is (...args: unknown[]) => void {
  return typeof value === 'function'
}

afterEach(() => {
  cleanupTempDirs()
})

describe('behavior-audit phase 2a classify agent', () => {
  test('classifyBehaviorWithRetry does not sleep before the first resumed retry attempt', async () => {
    const events: string[] = []
    const originalSetTimeout = globalThis.setTimeout
    const configRoot = makeTempDir()
    const mockSetTimeout = (
      handler: TimerHandler,
      _timeout: number | undefined,
      ...args: unknown[]
    ): ReturnType<typeof setTimeout> => {
      events.push('sleep')
      if (isCallableTimerHandler(handler)) {
        handler(...args)
      }
      return originalSetTimeout((): void => {}, 0)
    }

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      ...createReportsConfig(configRoot, {
        MODEL: 'qwen3-30b-a3b',
        BASE_URL: 'http://localhost:1234/v1',
        PHASE2_TIMEOUT_MS: 300_000,
        MAX_RETRIES: 3,
        RETRY_BACKOFF_MS: [25, 50, 75] as const,
        MAX_STEPS: 20,
      }),
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): (() => string) => {
        return (): string => 'mock-model'
      },
    }))
    void mock.module('ai', () => ({
      generateText: (): Promise<{ readonly output: MockClassificationResult }> => {
        events.push('generate')
        return Promise.resolve({
          output: {
            visibility: 'user-facing',
            candidateFeatureKey: 'task-creation',
            candidateFeatureLabel: 'Task creation',
            supportingBehaviorRefs: [],
            relatedBehaviorHints: [],
            classificationNotes: 'Immediate resumed success.',
          },
        })
      },
      Output: {
        object: ({ schema }: { readonly schema: unknown }): { readonly schema: unknown } => ({ schema }),
      },
      stepCountIs: (value: number): number => value,
    }))

    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      writable: true,
      value: mockSetTimeout,
    })

    try {
      const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())
      const result = await classifyAgent.classifyBehaviorWithRetry('prompt', 1)

      expect(result === null ? null : result.candidateFeatureKey).toBe('task-creation')
      expect(events).toEqual(['generate'])
    } finally {
      Object.defineProperty(globalThis, 'setTimeout', {
        configurable: true,
        writable: true,
        value: originalSetTimeout,
      })
    }
  })
})
