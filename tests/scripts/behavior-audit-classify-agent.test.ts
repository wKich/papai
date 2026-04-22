import { afterEach, describe, expect, test } from 'bun:test'

import { Output, stepCountIs } from 'ai'

import type { ClassifyAgentDeps } from '../../scripts/behavior-audit/classify-agent.js'
import { cleanupTempDirs } from './behavior-audit-integration.runtime-helpers.js'
import { loadClassifyAgentModule } from './behavior-audit-integration.support.js'

afterEach(() => {
  cleanupTempDirs()
})

describe('behavior-audit phase 2a classify agent', () => {
  test('classifyBehaviorWithRetry does not sleep before the first resumed retry attempt', async () => {
    const events: string[] = []
    const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())
    const generateText: ClassifyAgentDeps['generateText'] = (_input) => {
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
    }
    const sleep: ClassifyAgentDeps['sleep'] = (ms) => {
      events.push('sleep')
      return Promise.resolve(ms).then((): void => undefined)
    }

    const result = await classifyAgent.classifyBehaviorWithRetry('prompt', 1, {
      config: {
        BASE_URL: 'http://localhost:1234/v1',
        MODEL: 'qwen3-30b-a3b',
        PHASE2_TIMEOUT_MS: 300_000,
        MAX_RETRIES: 3,
        RETRY_BACKOFF_MS: [25, 50, 75] as const,
        MAX_STEPS: 20,
      },
      generateText,
      buildModel: () => 'mock-model',
      outputObject: Output.object,
      stepCountIs,
      sleep,
      createAbortSignal: () => AbortSignal.timeout(1),
    })

    expect(result === null ? null : result.candidateFeatureKey).toBe('task-creation')
    expect(events).toEqual(['generate'])
  })

  test('classifyBehaviorWithRetry sleeps before the next resumed retry attempt after a failure', async () => {
    const events: string[] = []
    const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())
    let attempts = 0
    const generateText: ClassifyAgentDeps['generateText'] = (_input) => {
      attempts += 1
      events.push(`generate:${attempts}`)

      if (attempts === 1) {
        return Promise.reject(new Error('temporary failure'))
      }

      return Promise.resolve({
        output: {
          visibility: 'user-facing',
          candidateFeatureKey: 'task-creation',
          candidateFeatureLabel: 'Task creation',
          supportingBehaviorRefs: [],
          relatedBehaviorHints: [],
          classificationNotes: 'Succeeded after one resumed retry.',
        },
      })
    }
    const sleep: ClassifyAgentDeps['sleep'] = (ms) => {
      events.push(`sleep:${ms}`)
      return Promise.resolve(ms).then((): void => undefined)
    }

    const result = await classifyAgent.classifyBehaviorWithRetry('prompt', 1, {
      config: {
        BASE_URL: 'http://localhost:1234/v1',
        MODEL: 'qwen3-30b-a3b',
        PHASE2_TIMEOUT_MS: 300_000,
        MAX_RETRIES: 4,
        RETRY_BACKOFF_MS: [25, 50, 75] as const,
        MAX_STEPS: 20,
      },
      generateText,
      buildModel: () => 'mock-model',
      outputObject: Output.object,
      stepCountIs,
      sleep,
      createAbortSignal: () => AbortSignal.timeout(1),
    })

    expect(result === null ? null : result.candidateFeatureKey).toBe('task-creation')
    expect(events).toEqual(['generate:1', 'sleep:50', 'generate:2'])
  })
})
