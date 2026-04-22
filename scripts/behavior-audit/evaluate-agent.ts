import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE3_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { makeAuditTools } from './tools.js'

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({
  name: 'behavior-audit-eval',
  apiKey,
  baseURL: BASE_URL,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are evaluating a single feature of a Telegram chat bot from the perspective of three non-technical personas. You have tools to read source files, search the codebase, find files, and list directories. Use them to look at actual bot responses, error messages, system prompts, and command help text to judge the real UX.

The user story for this feature has already been written. Your job is to evaluate the UX quality only.

For each persona, evaluate:
- discover (1-5): Would they find and trigger this feature naturally?
- use (1-5): Could they use it successfully without help?
- retain (1-5): Would they keep using it after the first time?

Respond with ONLY a JSON object:
{
  "maria": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "dani": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "viktor": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "flaws": ["flaw 1", "flaw 2"],
  "improvements": ["improvement 1", "improvement 2"]
}`

const PersonaScoreSchema = z.object({
  discover: z.number().min(1).max(5),
  use: z.number().min(1).max(5),
  retain: z.number().min(1).max(5),
  notes: z.string(),
})

const EvalResultSchema = z.object({
  maria: PersonaScoreSchema,
  dani: PersonaScoreSchema,
  viktor: PersonaScoreSchema,
  flaws: z.array(z.string()),
  improvements: z.array(z.string()),
})

export type EvalResult = z.infer<typeof EvalResultSchema>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function evaluateSingle(prompt: string, attempt: number): Promise<EvalResult | null> {
  const timeout = attempt > 0 ? PHASE3_TIMEOUT_MS * 2 : PHASE3_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      tools,
      output: Output.object({ schema: EvalResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (result.output === null) {
      console.log(`✗ null output (${elapsed}s)`)
      return null
    }
    console.log(`✓ (${elapsed}s)`)
    return result.output
  } catch (error) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`✗ ${error instanceof Error ? error.message : String(error)} (${elapsed}s)`)
    return null
  }
}

function retryWithBackoff(prompt: string, attempt: number, maxAttempts: number): Promise<EvalResult | null> {
  if (attempt >= maxAttempts) return Promise.resolve(null)
  return evaluateSingle(prompt, attempt).then((result) => {
    if (result !== null) return result
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!
    return sleep(backoff).then(() => retryWithBackoff(prompt, attempt + 1, maxAttempts))
  })
}

export function evaluateWithRetry(prompt: string): Promise<EvalResult | null> {
  return retryWithBackoff(prompt, 0, MAX_RETRIES)
}
