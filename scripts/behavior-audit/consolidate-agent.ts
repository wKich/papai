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
const provider = createOpenAICompatible({
  name: 'behavior-audit-consolidate',
  apiKey,
  baseURL: BASE_URL,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst reviewing extracted test behaviors from a Telegram/Discord/Mattermost chat bot called "papai".

The batch you receive is a candidate pool formed for context-size control and candidate similarity. It is not guaranteed to describe only one feature.

You must:
1. classify each consolidation as user-facing or internal
2. merge only behaviors that describe the same user-facing capability
3. never force one output per batch or one output per keyword
4. emit multiple consolidated outputs when the batch contains multiple distinct features
5. generate user stories only for user-facing consolidated features
6. keep internal-only consolidations separate and use userStory: null for them

Every user story must be feature-level, user-observable, complete in actor/action/benefit, and free of test names, function names, and implementation jargon.`

const ConsolidationItemSchema = z.object({
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceBehaviorIds: z.array(z.string()),
  sourceTestKeys: z.array(z.string()),
  supportingInternalRefs: z.array(z.object({ behaviorId: z.string(), summary: z.string() })),
})

const ConsolidationResultSchema = z.object({
  consolidations: z.array(ConsolidationItemSchema),
})

type ConsolidationResult = z.infer<typeof ConsolidationResultSchema>

export interface ConsolidateBehaviorInput {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly featureKey: string
  readonly featureLabel: string | null
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
}

function buildPrompt(featureKey: string, behaviors: readonly ConsolidateBehaviorInput[]): string {
  const behaviorList = behaviors
    .map(
      (b, i) =>
        `${i + 1}. BehaviorId: "${b.behaviorId}"\n   TestKey: "${b.testKey}"\n   Domain: ${b.domain}\n   Visibility: ${b.visibility}\n   Feature key: ${b.featureKey}\n   Feature label: ${b.featureLabel ?? '(none)'}\n   Keywords: ${b.keywords.join(', ')}\n   Behavior: ${b.behavior}\n   Context: ${b.context}`,
    )
    .join('\n\n')
  return `Feature key: ${featureKey}\n\nBehavior pool:\n\n${behaviorList}`
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
  featureKey: string,
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
      id: `${featureKey}::${slugify(item.featureName)}`,
      item,
    }))
  }

  return attemptConsolidation(prompt, featureKey, attempt + 1, remaining - 1)
}

export function consolidateWithRetry(
  featureKey: string,
  behaviors: readonly ConsolidateBehaviorInput[],
  attemptOffset: number,
): Promise<readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[] | null> {
  const prompt = buildPrompt(featureKey, behaviors)
  const remaining = MAX_RETRIES - attemptOffset
  return attemptConsolidation(prompt, featureKey, attemptOffset, remaining)
}
