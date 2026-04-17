import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs } from 'ai'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE2_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { makeAuditTools } from './tools.js'

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({ name: 'behavior-audit-eval', apiKey, baseURL: BASE_URL })
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are evaluating a single behavior of a Telegram chat bot from the perspective of three non-technical personas. You have tools to read source files, search the codebase, find files, and list directories. Use them to look at actual bot responses, error messages, system prompts, and command help text to judge the real UX.

For each persona, evaluate:
- discover (1-5): Would they find and trigger this feature naturally?
- use (1-5): Could they use it successfully without help?
- retain (1-5): Would they keep using it after the first time?

Also identify the user story this behavior fulfills.

Respond with ONLY a JSON object:
{
  "userStory": "As a [user type], I want to [action] so that [benefit].",
  "maria": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "dani": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "viktor": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "flaws": ["flaw 1", "flaw 2"],
  "improvements": ["improvement 1", "improvement 2"]
}`

export interface EvalResult {
  readonly userStory: string
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
}

function isPersonaScore(raw: unknown): raw is EvalResult['maria'] {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'discover' in raw &&
    typeof raw.discover === 'number' &&
    'use' in raw &&
    typeof raw.use === 'number' &&
    'retain' in raw &&
    typeof raw.retain === 'number' &&
    'notes' in raw &&
    typeof raw.notes === 'string'
  )
}

function isStringArray(raw: unknown): raw is readonly string[] {
  return Array.isArray(raw) && raw.every((item) => typeof item === 'string')
}

function isValidEval(raw: unknown): raw is EvalResult {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'userStory' in raw &&
    typeof (raw as Record<string, unknown>)['userStory'] === 'string' &&
    'maria' in raw &&
    isPersonaScore(raw.maria) &&
    'dani' in raw &&
    isPersonaScore(raw.dani) &&
    'viktor' in raw &&
    isPersonaScore(raw.viktor) &&
    'flaws' in raw &&
    isStringArray(raw.flaws) &&
    'improvements' in raw &&
    isStringArray(raw.improvements)
  )
}

function parseJsonResponse(text: string): EvalResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch === null) return null
    const raw: unknown = JSON.parse(jsonMatch[0])
    if (isValidEval(raw)) return raw
    return null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function evaluateSingle(prompt: string, attempt: number): Promise<EvalResult | null> {
  const timeout = attempt > 0 ? PHASE2_TIMEOUT_MS * 2 : PHASE2_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: AbortSignal.timeout(timeout),
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const parsed = parseJsonResponse(result.text)
    if (parsed === null) {
      console.log(`✗ malformed JSON (${elapsed}s)`)
      return null
    }
    console.log(`✓ (${elapsed}s)`)
    return parsed
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
