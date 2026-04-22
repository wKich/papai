import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE2_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'

const ClassificationResultSchema = z.object({
  visibility: z.enum(['user-facing', 'internal', 'ambiguous']),
  candidateFeatureKey: z.string().nullable(),
  candidateFeatureLabel: z.string().nullable(),
  supportingBehaviorRefs: z.array(z.object({ behaviorId: z.string(), reason: z.string() })),
  relatedBehaviorHints: z.array(
    z.object({
      testKey: z.string(),
      relation: z.enum(['same-feature', 'supporting-detail', 'possibly-related']),
      reason: z.string(),
    }),
  ),
  classificationNotes: z.string(),
})

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>

type ClassifyConfig = {
  readonly BASE_URL: string
  readonly MODEL: string
  readonly PHASE2_TIMEOUT_MS: number
  readonly MAX_RETRIES: number
  readonly RETRY_BACKOFF_MS: readonly [number, ...number[]]
  readonly MAX_STEPS: number
}

type ClassifyAgentInput = Parameters<typeof generateText>[0]
type ClassifyAgentModel = ClassifyAgentInput['model']
type ClassifyAgentOutput = NonNullable<ClassifyAgentInput['output']>
type ClassifyAgentStopWhen = NonNullable<ClassifyAgentInput['stopWhen']>

export interface ClassifyAgentDeps {
  readonly config: ClassifyConfig
  readonly generateText: (input: ClassifyAgentInput) => Promise<{ readonly output: ClassificationResult }>
  readonly outputObject: (input: { readonly schema: typeof ClassificationResultSchema }) => ClassifyAgentOutput
  readonly stepCountIs: (stepCount: number) => ClassifyAgentStopWhen
  readonly buildModel: (baseUrl: string, model: string, apiKey: string) => ClassifyAgentModel
  readonly sleep: (ms: number) => Promise<void>
  readonly createAbortSignal: (timeout: number) => AbortSignal
}

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) {
    return fallback
  }
  return value
}

const SYSTEM_PROMPT = `You are classifying one extracted behavior from a test suite into a stable feature-assignment record.

Return structured output with:
- visibility: user-facing, internal, or ambiguous
- candidateFeatureKey: canonical stable feature key when applicable
- candidateFeatureLabel: short human-readable feature label when applicable
- supportingBehaviorRefs: internal supporting behavior references by behaviorId
- relatedBehaviorHints: nearby behaviors that are same-feature, supporting-detail, or possibly-related
- classificationNotes: concise reasoning for maintainers

Prefer reusing an existing candidateFeatureKey when semantically compatible. Preserve ambiguity instead of forcing a merge.`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function createDefaultClassifyAgentDeps(): ClassifyAgentDeps {
  const defaultApiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
  const defaultModel = createOpenAICompatible({
    name: 'behavior-audit-classify',
    apiKey: defaultApiKey,
    baseURL: BASE_URL,
    supportsStructuredOutputs: true,
  })(MODEL)

  return {
    config: {
      BASE_URL,
      MODEL,
      PHASE2_TIMEOUT_MS,
      MAX_RETRIES,
      RETRY_BACKOFF_MS,
      MAX_STEPS,
    },
    generateText: (input) => generateText(input),
    outputObject: ({ schema }) => Output.object({ schema }),
    stepCountIs: (stepCount) => stepCountIs(stepCount),
    buildModel: () => defaultModel,
    sleep,
    createAbortSignal: (timeout) => AbortSignal.timeout(timeout),
  }
}

async function classifySingle(
  prompt: string,
  attempt: number,
  deps: ClassifyAgentDeps,
): Promise<ClassificationResult | null> {
  const timeout = attempt > 0 ? deps.config.PHASE2_TIMEOUT_MS * 2 : deps.config.PHASE2_TIMEOUT_MS
  try {
    const result = await deps.generateText({
      model: deps.buildModel(deps.config.BASE_URL, deps.config.MODEL, getEnvOrFallback('OPENAI_API_KEY', 'no-key')),
      system: SYSTEM_PROMPT,
      prompt,
      output: deps.outputObject({ schema: ClassificationResultSchema }),
      stopWhen: deps.stepCountIs(deps.config.MAX_STEPS + 1),
      abortSignal: deps.createAbortSignal(timeout),
    })
    return result.output
  } catch {
    return null
  }
}

function getRetryBackoff(attempt: number, deps: ClassifyAgentDeps): number {
  const [firstBackoff] = deps.config.RETRY_BACKOFF_MS
  const backoffIndex = Math.min(attempt - 1, deps.config.RETRY_BACKOFF_MS.length - 1)
  const backoff = deps.config.RETRY_BACKOFF_MS[backoffIndex]
  if (backoff === undefined) {
    return firstBackoff
  }
  return backoff
}

async function classifyAttempt(
  prompt: string,
  attempt: number,
  attemptOffset: number,
  deps: ClassifyAgentDeps,
): Promise<ClassificationResult | null> {
  if (attempt > attemptOffset) {
    await deps.sleep(getRetryBackoff(attempt, deps))
  }
  return classifySingle(prompt, attempt, deps)
}

function retryClassification(
  prompt: string,
  attempt: number,
  attemptOffset: number,
  deps: ClassifyAgentDeps,
): Promise<ClassificationResult | null> {
  if (attempt >= deps.config.MAX_RETRIES) {
    return Promise.resolve(null)
  }

  return classifyAttempt(prompt, attempt, attemptOffset, deps).then((result) => {
    if (result !== null) {
      return result
    }
    return retryClassification(prompt, attempt + 1, attemptOffset, deps)
  })
}

export function classifyBehaviorWithRetry(prompt: string, attemptOffset: number): Promise<ClassificationResult | null>
export function classifyBehaviorWithRetry(
  prompt: string,
  attemptOffset: number,
  deps: ClassifyAgentDeps,
): Promise<ClassificationResult | null>
export function classifyBehaviorWithRetry(
  ...args: readonly [string, number] | readonly [string, number, ClassifyAgentDeps]
): Promise<ClassificationResult | null> {
  const [prompt, attemptOffset] = args
  if (args.length === 2) {
    return retryClassification(prompt, attemptOffset, attemptOffset, createDefaultClassifyAgentDeps())
  }
  const [, , deps] = args
  return retryClassification(prompt, attemptOffset, attemptOffset, deps)
}
