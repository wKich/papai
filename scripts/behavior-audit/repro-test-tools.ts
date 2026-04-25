import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, tool, wrapLanguageModel, extractJsonMiddleware } from 'ai'
import { z } from 'zod'

const BASE_URL = 'http://localhost:8000/v1'
const API_KEY = '2657'
const MODELS = ['Gemma-4-26B-A4B', 'Qwen3.6-35B-A3B'] as const
const SEEDS = [0, 42, 84]
const MAX_TOKENS = 8192
const TIMEOUT_MS = 300_000

const BeachSchema = z.object({
  description: z.string().describe('At least 3 detailed sentences about a beach at sunset.'),
  analysis: z
    .string()
    .describe(
      'Several paragraphs of deep philosophical analysis about sunsets, transience, and human connection to nature. Write at least 500 words.',
    ),
  tags: z.array(z.string()).describe('Relevant keyword slugs.'),
})

const SYSTEM_PROMPT = `You are a helpful assistant. Produce a JSON object with:
- description: at least 3 detailed sentences about a beach at sunset
- analysis: several paragraphs of deep philosophical analysis - write at least 500 words
- tags: array of relevant keyword slugs

Output ONLY raw JSON, no markdown fences or explanation.`

const USER_PROMPT =
  'Describe a beach scene at sunset in vivid sensory detail. Then provide several paragraphs of deep philosophical analysis about what sunsets mean to human consciousness, the nature of transience, and our connection to the natural world. Be expansive and thorough.'

type Mode =
  | 'tool-call-strict'
  | 'tool-call-no-strict'
  | 'output-object-strict'
  | 'output-object-no-strict'
  | 'wrap-json-extraction'
  | 'json-schema-raw'

const MODE_DESCRIPTIONS: Record<Mode, string> = {
  'tool-call-strict': 'tool() + supportsStructuredOutputs:true → server enforces schema on tool args',
  'tool-call-no-strict': 'tool() + supportsStructuredOutputs:false → free-form tool args',
  'output-object-strict': 'Output.object() + supportsStructuredOutputs:true → json_schema response_format',
  'output-object-no-strict': 'Output.object() + supportsStructuredOutputs:false → json_object response_format',
  'wrap-json-extraction': 'wrapLanguageModel(extractJsonMiddleware) + plain text → post-hoc parse',
  'json-schema-raw': 'raw fetch with response_format=json_schema',
}

function makeProviders(modelName: string) {
  const noStrict = createOpenAICompatible({
    name: 'repro',
    apiKey: API_KEY,
    baseURL: BASE_URL,
    supportsStructuredOutputs: false,
  })
  const strict = createOpenAICompatible({
    name: 'repro-strict',
    apiKey: API_KEY,
    baseURL: BASE_URL,
    supportsStructuredOutputs: true,
  })
  const raw = noStrict(modelName)
  const wrapped = wrapLanguageModel({ model: raw, middleware: extractJsonMiddleware() })
  return { noStrict, strict, raw, wrapped, rawStrict: strict(modelName) }
}

function maxConsecutive(words: string[]): number {
  let maxRun = 1
  let current = 1
  for (let i = 1; i < words.length; i++) {
    if (words[i]!.toLowerCase() === words[i - 1]!.toLowerCase()) {
      current++
      if (current > maxRun) maxRun = current
    } else {
      current = 1
    }
  }
  return maxRun
}

function detectRepetition(text: string): { collapsed: boolean; maxConsec: number; repeatedToken: string | null } {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 10) return { collapsed: false, maxConsec: 0, repeatedToken: null }
  let maxCount = 0
  let maxToken: string | null = null
  const counts = new Map<string, number>()
  for (const w of words) {
    const c = (counts.get(w) ?? 0) + 1
    counts.set(w, c)
    if (c > maxCount) {
      maxCount = c
      maxToken = w
    }
  }
  const mc = maxConsecutive(words)
  return { collapsed: mc >= 10, maxConsec: mc, repeatedToken: maxToken }
}

function parseJsonOutput(text: string): { valid: boolean; hasSchema: boolean; parsed: Record<string, unknown> | null } {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch === null) return { valid: false, hasSchema: false, parsed: null }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const d = parsed.description
    const a = parsed.analysis
    const t = parsed.tags
    const hasSchema =
      typeof d === 'string' &&
      d.length > 20 &&
      typeof a === 'string' &&
      a.length > 20 &&
      Array.isArray(t) &&
      t.length > 0
    return { valid: true, hasSchema, parsed }
  } catch {
    return { valid: false, hasSchema: false, parsed: null }
  }
}

function classifyOutput(text: string, rep: ReturnType<typeof detectRepetition>): string {
  if (rep.collapsed) return 'REPETITION'
  const p = parseJsonOutput(text)
  if (p.hasSchema) return 'OK'
  if (p.valid) return 'BAD_SCHEMA'
  return 'BAD_JSON'
}

const beachTool = tool({
  description: 'Save a detailed beach scene description with analysis and tags.',
  parameters: BeachSchema,
  execute: async (input) => ({
    saved: true,
    descLen: input.description.length,
    analysisLen: input.analysis.length,
    tagCount: input.tags.length,
  }),
})

async function runMode(providers: ReturnType<typeof makeProviders>, mode: Mode, seed: number): Promise<void> {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    let text = ''
    let finishReason = ''
    let outTokens = 0

    if (mode === 'tool-call-strict') {
      const r = await generateText({
        model: providers.rawStrict,
        system: 'You are a helpful assistant. Use the provided tools when asked.',
        prompt: USER_PROMPT,
        tools: { save_beach: beachTool },
        maxOutputTokens: MAX_TOKENS,
        abortSignal: controller.signal,
      })
      clearTimeout(timer)
      outTokens = r.totalUsage.outputTokens
      finishReason = r.toolCalls.length > 0 ? 'tool_call' : r.finishReason
      text = r.toolCalls.length > 0 ? JSON.stringify(r.toolCalls[0]!.input) : r.text
    } else if (mode === 'tool-call-no-strict') {
      const r = await generateText({
        model: providers.raw,
        system: 'You are a helpful assistant. Use the provided tools when asked.',
        prompt: USER_PROMPT,
        tools: { save_beach: beachTool },
        maxOutputTokens: MAX_TOKENS,
        abortSignal: controller.signal,
      })
      clearTimeout(timer)
      outTokens = r.totalUsage.outputTokens
      finishReason = r.toolCalls.length > 0 ? 'tool_call' : r.finishReason
      text = r.toolCalls.length > 0 ? JSON.stringify(r.toolCalls[0]!.input) : r.text
    } else if (mode === 'output-object-strict') {
      const r = await generateText({
        model: providers.rawStrict,
        system: SYSTEM_PROMPT,
        prompt: USER_PROMPT,
        output: Output.object({ schema: BeachSchema }),
        maxOutputTokens: MAX_TOKENS,
        abortSignal: controller.signal,
      })
      clearTimeout(timer)
      outTokens = r.totalUsage.outputTokens
      finishReason = r.finishReason
      text = r.output !== null ? JSON.stringify(r.output) : r.text
    } else if (mode === 'output-object-no-strict') {
      const r = await generateText({
        model: providers.raw,
        system: SYSTEM_PROMPT,
        prompt: USER_PROMPT,
        output: Output.object({ schema: BeachSchema }),
        maxOutputTokens: MAX_TOKENS,
        abortSignal: controller.signal,
      })
      clearTimeout(timer)
      outTokens = r.totalUsage.outputTokens
      finishReason = r.finishReason
      text = r.output !== null ? JSON.stringify(r.output) : r.text
    } else if (mode === 'wrap-json-extraction') {
      const r = await generateText({
        model: providers.wrapped,
        system: SYSTEM_PROMPT,
        prompt: USER_PROMPT,
        maxOutputTokens: MAX_TOKENS,
        abortSignal: controller.signal,
      })
      clearTimeout(timer)
      outTokens = r.totalUsage.outputTokens
      finishReason = r.finishReason
      text = r.text
    } else if (mode === 'json-schema-raw') {
      const body = {
        model: providers.raw.modelId,
        messages: [{ role: 'user', content: USER_PROMPT }],
        max_tokens: MAX_TOKENS,
        seed,
        temperature: 0.7,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            strict: true,
            schema: {
              type: 'object',
              required: ['description', 'analysis', 'tags'],
              properties: {
                description: { type: 'string', description: 'At least 3 detailed sentences about a beach at sunset.' },
                analysis: {
                  type: 'string',
                  description: 'Several paragraphs of deep philosophical analysis. Write at least 500 words.',
                },
                tags: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      }
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string }; finish_reason: string }>
        usage: { completion_tokens: number }
      }
      text = json.choices[0]?.message?.content ?? ''
      finishReason = json.choices[0]?.finish_reason ?? ''
      outTokens = json.usage?.completion_tokens ?? 0
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const rep = detectRepetition(text)
    const status = classifyOutput(text, rep)

    console.log(
      `  seed=${seed}  ${status.padEnd(12)} finish=${finishReason.padEnd(10)} tokens=${String(outTokens).padStart(5)} time=${elapsed.padStart(6)}s  maxConsec="${rep.repeatedToken ?? '-'}"×${rep.maxConsec}  len=${text.length}`,
    )

    if (rep.collapsed) {
      console.log(`    TAIL: "${text.slice(-300).replace(/\n/g, '\\n')}"`)
    }
  } catch (err) {
    clearTimeout(timer)
    const msg = err instanceof Error ? err.message : String(err)
    const shortMsg = msg.length > 200 ? msg.slice(0, 200) + '...' : msg
    console.log(`  seed=${seed}  FAIL: ${shortMsg}`)
  }
}

const MODES: Mode[] = [
  'tool-call-strict',
  'tool-call-no-strict',
  'output-object-strict',
  'output-object-no-strict',
  'wrap-json-extraction',
  'json-schema-raw',
]

console.log(`Base URL: ${BASE_URL}`)
console.log(`Seeds: ${SEEDS.join(', ')}`)
console.log(`Max tokens: ${MAX_TOKENS}`)

for (const modelName of MODELS) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Model: ${modelName}`)
  console.log('='.repeat(60))
  const providers = makeProviders(modelName)

  for (const mode of MODES) {
    console.log(`\n--- ${mode} ---`)
    console.log(`    ${MODE_DESCRIPTIONS[mode]}`)
    for (const seed of SEEDS) {
      await runMode(providers, mode, seed)
    }
  }
}

console.log('\nDone.')
