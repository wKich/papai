import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { makeAuditTools } from './tools.js'

const ExtractionResultSchema = z.object({
  behavior: z.string(),
  context: z.string(),
  candidateKeywords: z.array(z.string()).min(8).max(16),
})

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>

function getEnvOrFallback(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({
  name: 'behavior-audit-extract',
  apiKey,
  baseURL: BASE_URL,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst examining a unit test from a Telegram/Discord/Mattermost chat bot called "papai" that manages tasks via LLM tool-calling.

Return structured output with:
- behavior: plain-language feature description beginning with "When..."
- context: technical implementation summary for developers
- candidateKeywords: 8-16 canonical lowercase slug keywords describing the behavior

Keywords must be short canonical slugs like group-targeting or identity-resolution.`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function extractSingle(prompt: string, attempt: number): Promise<ExtractionResult | null> {
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      tools: makeAuditTools(),
      output: Output.object({ schema: ExtractionResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    return result.output
  } catch {
    return null
  }
}

export async function extractWithRetry(prompt: string, attempt: number): Promise<ExtractionResult | null> {
  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
    await sleep(backoff)
  }
  const result = await extractSingle(prompt, attempt)
  if (result !== null) return result
  if (attempt >= MAX_RETRIES - 1) return null
  return extractWithRetry(prompt, attempt + 1)
}
