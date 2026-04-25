import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { fetchWithoutTimeout, verboseGenerateText } from './agent-helpers.js'
import { addAgentUsage, type AgentResult, type AgentUsage } from './phase-stats.js'
import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'

const VocabularyEntrySchema = z.object({
  slug: z.string(),
  description: z.string(),
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
  fetch: fetchWithoutTimeout,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function resolveSingle(
  prompt: string,
  attempt: number,
): Promise<{ data: ResolverResult | null; usage: AgentUsage }> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  try {
    const result = await verboseGenerateText({
      model,
      prompt,
      maxOutputTokens: 4096,
      output: Output.object({ schema: ResolverResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    usage.inputTokens = result.totalUsage.inputTokens ?? 0
    usage.outputTokens = result.totalUsage.outputTokens ?? 0
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        usage.toolCalls += 1
        usage.toolNames.push(tc.toolName)
      }
    }
    const parsed = ResolverResultSchema.safeParse(result.output)
    return { data: parsed.success ? parsed.data : null, usage }
  } catch (error) {
    console.log(`✗ resolve: ${error instanceof Error ? error.message : String(error)}`)
    return { data: null, usage }
  }
}

export async function resolveKeywordsWithRetry(
  prompt: string,
  attempt: number,
): Promise<AgentResult<ResolverResult> | null> {
  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
    await sleep(backoff)
  }
  const { data, usage } = await resolveSingle(prompt, attempt)
  if (data !== null) return { result: data, usage }
  if (attempt >= MAX_RETRIES - 1) return null
  const nextResult = await resolveKeywordsWithRetry(prompt, attempt + 1)
  if (nextResult === null) return null
  return { result: nextResult.result, usage: addAgentUsage(usage, nextResult.usage) }
}
