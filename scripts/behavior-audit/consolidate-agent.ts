import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE2_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { makeAuditTools } from './tools.js'

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({ name: 'behavior-audit-consolidate', apiKey, baseURL: BASE_URL })
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst reviewing extracted test behaviors from a Telegram/Discord/Mattermost chat bot called "papai". Your job is to consolidate per-test behaviors into feature-level descriptions.

For the list of behaviors you receive (all from the same domain), you must:

1. CLASSIFY each behavior as either:
   - "user_facing": the behavior describes something a user can discover, trigger, or observe as a real product feature
   - "internal": the behavior describes implementation details, internal routing, string parsing edge cases, data format correctness, or pure utility function behavior

2. CONSOLIDATE related behaviors. Multiple tests that cover the same feature from different angles (happy path, error cases, edge cases, boundary conditions) should be merged into a single feature-level entry. A single consolidated entry can reference many source tests.

3. For each consolidated behavior, produce:
   - featureName: a short (3-6 word) name for the feature
   - isUserFacing: true or false
   - behavior: a single plain-language description starting with "When..." that covers the full feature (not just one test case)
   - userStory: "As a [user type], I want [action] so that [benefit]." — required only when isUserFacing=true, null otherwise
   - context: one paragraph describing the implementation chain (relevant functions, DB tables, key logic)
   - sourceTestKeys: array of original test keys that were merged into this entry (pass through exactly as provided)

You have tools to read source files, search the codebase, find files, and list directories. Use them to understand the implementation if needed.`

const ConsolidationItemSchema = z.object({
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()),
})

const ConsolidationResultSchema = z.object({
  consolidations: z.array(ConsolidationItemSchema),
})

type ConsolidationResult = z.infer<typeof ConsolidationResultSchema>

export interface ConsolidateBehaviorInput {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
}

function buildPrompt(domain: string, behaviors: readonly ConsolidateBehaviorInput[]): string {
  const behaviorList = behaviors
    .map((b, i) => `${i + 1}. TestKey: "${b.testKey}"\n   Behavior: ${b.behavior}\n   Context: ${b.context}`)
    .join('\n\n')
  return `Domain: ${domain}\n\nExtracted behaviors:\n\n${behaviorList}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function consolidateSingle(prompt: string, attempt: number): Promise<ConsolidationResult | null> {
  const timeout = attempt > 0 ? PHASE2_TIMEOUT_MS * 2 : PHASE2_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      tools,
      output: Output.object({ schema: ConsolidationResultSchema }),
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
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`✗ error: ${err instanceof Error ? err.message : String(err)} (${elapsed}s)`)
    return null
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function attemptConsolidation(
  prompt: string,
  domain: string,
  attempt: number,
  remaining: number,
): Promise<readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[] | null> {
  if (remaining <= 0) return null

  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!
    console.log(`  retry ${attempt}/${MAX_RETRIES - 1}, waiting ${backoff / 1000}s...`)
    await sleep(backoff)
  }

  const result = await consolidateSingle(prompt, attempt)
  if (result !== null) {
    return result.consolidations.map((item) => ({
      id: `${domain}::${slugify(item.featureName)}`,
      item,
    }))
  }

  return attemptConsolidation(prompt, domain, attempt + 1, remaining - 1)
}

export function consolidateWithRetry(
  domain: string,
  behaviors: readonly ConsolidateBehaviorInput[],
  attemptOffset: number,
): Promise<readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[] | null> {
  const prompt = buildPrompt(domain, behaviors)
  const remaining = MAX_RETRIES - attemptOffset
  return attemptConsolidation(prompt, domain, attemptOffset, remaining)
}
