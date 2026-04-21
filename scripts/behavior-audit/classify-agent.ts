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

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) {
    return fallback
  }
  return value
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({
  name: 'behavior-audit-classify',
  apiKey,
  baseURL: BASE_URL,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

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

async function classifySingle(prompt: string, attempt: number): Promise<ClassificationResult | null> {
  const timeout = attempt > 0 ? PHASE2_TIMEOUT_MS * 2 : PHASE2_TIMEOUT_MS
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      output: Output.object({ schema: ClassificationResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    return result.output
  } catch {
    return null
  }
}

function getRetryBackoff(attempt: number): number {
  return RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
}

async function classifyAttempt(
  prompt: string,
  attempt: number,
  attemptOffset: number,
): Promise<ClassificationResult | null> {
  if (attempt > attemptOffset) {
    await sleep(getRetryBackoff(attempt))
  }
  return classifySingle(prompt, attempt)
}

function retryClassification(
  prompt: string,
  attempt: number,
  attemptOffset: number,
): Promise<ClassificationResult | null> {
  if (attempt >= MAX_RETRIES) {
    return Promise.resolve(null)
  }

  return classifyAttempt(prompt, attempt, attemptOffset).then((result) => {
    if (result !== null) {
      return result
    }
    return retryClassification(prompt, attempt + 1, attemptOffset)
  })
}

export function classifyBehaviorWithRetry(prompt: string, attemptOffset: number): Promise<ClassificationResult | null> {
  return retryClassification(prompt, attemptOffset, attemptOffset)
}
