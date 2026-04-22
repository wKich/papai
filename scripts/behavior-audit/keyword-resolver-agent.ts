import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'

const VocabularyEntrySchema = z.object({
  slug: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  timesUsed: z.number(),
})

const ResolverResultSchema = z.object({
  keywords: z.array(z.string()).min(1),
  appendedEntries: z.array(VocabularyEntrySchema),
})

export type ResolverResult = z.infer<typeof ResolverResultSchema>

function getEnvOrFallback(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({
  name: 'behavior-audit-keyword-resolver',
  apiKey,
  baseURL: BASE_URL,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function resolveSingle(prompt: string, attempt: number): Promise<ResolverResult | null> {
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  try {
    const result = await generateText({
      model,
      prompt,
      output: Output.object({ schema: ResolverResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    return result.output
  } catch {
    return null
  }
}

export async function resolveKeywordsWithRetry(prompt: string, attempt: number): Promise<ResolverResult | null> {
  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
    await sleep(backoff)
  }
  const result = await resolveSingle(prompt, attempt)
  if (result !== null) return result
  if (attempt >= MAX_RETRIES - 1) return null
  return resolveKeywordsWithRetry(prompt, attempt + 1)
}
