import { afterEach, describe, expect, mock, test } from 'bun:test'

import * as realAi from 'ai'
import { Output, stepCountIs } from 'ai'

import type { ClassifyAgentDeps } from '../../scripts/behavior-audit/classify-agent.js'
import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import { cleanupTempDirs, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import { loadClassifyAgentModule } from './behavior-audit-integration.support.js'

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

function startCountingFailureServer(): {
  readonly url: string
  readonly getRequestCount: () => number
  readonly stop: () => void
} {
  let requestCount = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      requestCount += 1
      return new Response('upstream failure', { status: 500 })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    getRequestCount: () => requestCount,
    stop: () => {
      void server.stop(true)
    },
  }
}

describe('behavior-audit phase 2a classify agent', () => {
  test('classifyBehaviorWithRetry does not sleep before the first resumed retry attempt', async () => {
    const events: string[] = []
    const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())
    const generateText: ClassifyAgentDeps['generateText'] = (_input) => {
      events.push('generate')
      return Promise.resolve({
        output: {
          visibility: 'user-facing',
          featureKey: 'task-creation',
          featureLabel: 'Task creation',
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

    expect(result === null ? null : result.featureKey).toBe('task-creation')
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
          featureKey: 'task-creation',
          featureLabel: 'Task creation',
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

    expect(result === null ? null : result.featureKey).toBe('task-creation')
    expect(events).toEqual(['generate:1', 'sleep:50', 'generate:2'])
  })

  test('classifyBehaviorWithRetry default path reads reloaded config after module import', async () => {
    const initialServer = startCountingFailureServer()
    const reloadedServer = startCountingFailureServer()
    let capturedBaseUrl: string | null = null
    let capturedModelValue: unknown = null
    let generateTextCalls = 0

    try {
      process.env['BEHAVIOR_AUDIT_BASE_URL'] = initialServer.url
      process.env['BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS'] = '100'
      process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = '1'
      reloadBehaviorAuditConfig()

      void mock.module('@ai-sdk/openai-compatible', () => ({
        createOpenAICompatible:
          ({ baseURL }: { readonly baseURL: string }) =>
          (model: string): string => {
            capturedBaseUrl = baseURL
            return `mock-model:${baseURL}:${model}`
          },
      }))
      void mock.module('ai', () => ({
        ...realAi,
        generateText: (input: { readonly model: unknown }): Promise<never> => {
          generateTextCalls += 1
          capturedModelValue = input.model
          return Promise.reject(new Error('forced failure'))
        },
      }))

      const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())

      process.env['BEHAVIOR_AUDIT_BASE_URL'] = reloadedServer.url
      reloadBehaviorAuditConfig()

      await expect(classifyAgent.classifyBehaviorWithRetry('prompt', 0)).resolves.toBeNull()
      expect(generateTextCalls).toBe(1)
      expect(initialServer.getRequestCount()).toBe(0)
      expect(reloadedServer.getRequestCount()).toBe(0)
      expect(capturedBaseUrl).not.toBeNull()
      if (capturedBaseUrl === null) {
        throw new Error('Expected captured base URL')
      }
      const resolvedBaseUrl: string = capturedBaseUrl
      expect(resolvedBaseUrl).toBe(reloadedServer.url)
      expect(typeof capturedModelValue).toBe('string')
      expect(String(capturedModelValue)).toContain(reloadedServer.url)
    } finally {
      initialServer.stop()
      reloadedServer.stop()
    }
  })
})
