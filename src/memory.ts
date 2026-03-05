import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject } from 'ai'
import { type ModelMessage } from 'ai'
import { z } from 'zod'

import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'memory' })

const FACTS_CAP = 50

export type MemoryFact = {
  readonly identifier: string
  readonly title: string
  readonly url: string
  readonly last_seen: string
}

export type ModelConfig = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

// --- Summary persistence ---

export function loadSummary(userId: number): string | null {
  log.debug({ userId }, 'loadSummary called')
  const row = getDb()
    .query<{ summary: string }, [number]>('SELECT summary FROM memory_summary WHERE user_id = ?')
    .get(userId)
  return row?.summary ?? null
}

export function saveSummary(userId: number, summary: string): void {
  log.debug({ userId, summaryLength: summary.length }, 'saveSummary called')
  getDb().run('INSERT OR REPLACE INTO memory_summary (user_id, summary, updated_at) VALUES (?, ?, ?)', [
    userId,
    summary,
    new Date().toISOString(),
  ])
  log.info({ userId, summaryLength: summary.length }, 'Summary saved')
}

export function clearSummary(userId: number): void {
  log.debug({ userId }, 'clearSummary called')
  getDb().run('DELETE FROM memory_summary WHERE user_id = ?', [userId])
  log.info({ userId }, 'Summary cleared')
}

// --- Fact persistence ---

export function loadFacts(userId: number): readonly MemoryFact[] {
  log.debug({ userId }, 'loadFacts called')
  const rows = getDb()
    .query<MemoryFact, [number]>(
      'SELECT identifier, title, url, last_seen FROM memory_facts WHERE user_id = ? ORDER BY last_seen DESC',
    )
    .all(userId)
  return rows
}

export function upsertFact(userId: number, fact: Omit<MemoryFact, 'last_seen'>): void {
  log.debug({ userId, identifier: fact.identifier }, 'upsertFact called')
  const now = new Date().toISOString()
  getDb().run(
    'INSERT OR REPLACE INTO memory_facts (user_id, identifier, title, url, last_seen) VALUES (?, ?, ?, ?, ?)',
    [userId, fact.identifier, fact.title, fact.url, now],
  )
  // Evict oldest facts beyond cap
  getDb().run(
    `DELETE FROM memory_facts WHERE user_id = ? AND identifier NOT IN (
      SELECT identifier FROM memory_facts WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?
    )`,
    [userId, userId, FACTS_CAP],
  )
  log.info({ userId, identifier: fact.identifier }, 'Fact upserted')
}

export function clearFacts(userId: number): void {
  log.debug({ userId }, 'clearFacts called')
  getDb().run('DELETE FROM memory_facts WHERE user_id = ?', [userId])
  log.info({ userId }, 'Facts cleared')
}

// --- Rule-based fact extraction ---

type ToolCallEntry = { toolName: string; args: unknown }
type ToolResultEntry = { toolName: string; result: unknown }

const IssueResultSchema = z.looseObject({
  identifier: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
})

export function extractFacts(
  _toolCalls: readonly ToolCallEntry[],
  toolResults: readonly ToolResultEntry[],
): readonly Omit<MemoryFact, 'last_seen'>[] {
  const facts: Omit<MemoryFact, 'last_seen'>[] = []

  for (const result of toolResults) {
    if (['create_issue', 'update_issue', 'get_issue'].includes(result.toolName)) {
      const parsed = IssueResultSchema.safeParse(result.result)
      if (parsed.success) {
        facts.push({
          identifier: parsed.data.identifier,
          title: parsed.data.title ?? parsed.data.identifier,
          url: parsed.data.url ?? '',
        })
      }
    }

    if (result.toolName === 'search_issues') {
      const items = z.array(IssueResultSchema).safeParse(result.result)
      if (items.success) {
        for (const item of items.data.slice(0, 3)) {
          facts.push({
            identifier: item.identifier,
            title: item.title ?? item.identifier,
            url: item.url ?? '',
          })
        }
      }
    }
  }

  return facts
}

// --- Smart trimming with memory model ---

const TrimResultSchema = z.object({
  keep_indices: z.array(z.number().int().nonnegative()),
  summary: z.string(),
})

export type TrimResult = {
  readonly trimmedMessages: readonly ModelMessage[]
  readonly summary: string
}

const TRIM_PROMPT = `You are a conversation memory manager. The following conversation history has grown too long ({TOTAL} messages).

Your task:
1. Select between 50 and 100 message indices (0-based) to retain verbatim. Choose fewer (~50) when many threads are resolved and the history is repetitive. Choose more (~100) when conversations are active and many topics are still open. Prefer messages about active unresolved Linear issues, recent decisions, ongoing threads, and stated preferences. Drop messages about completed tasks, resolved clarifications, and abandoned threads.
2. Write an updated summary (max 200 words) for all messages NOT retained. Incorporate the previous summary. Preserve: issue identifiers (e.g. ENG-42), project names, decisions, priorities, preferences.

Previous summary:
{PREVIOUS_SUMMARY}

Conversation (index: [role] content):
{MESSAGES}

Return JSON exactly matching the schema.`

export async function trimWithMemoryModel(
  history: readonly ModelMessage[],
  trimMin: number,
  trimMax: number,
  previousSummary: string | null,
  config: ModelConfig,
): Promise<TrimResult> {
  log.debug(
    { messageCount: history.length, trimMin, trimMax, hasPrevious: previousSummary !== null },
    'trimWithMemoryModel called',
  )

  const model = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })(config.model)

  const messagesText = history
    .map((m, i) => `${i}: [${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n')

  const prompt = TRIM_PROMPT.replace(/\{TOTAL\}/g, String(history.length))
    .replace('{PREVIOUS_SUMMARY}', previousSummary ?? '(none)')
    .replace('{MESSAGES}', messagesText)

  const result = await generateObject({
    model,
    schema: TrimResultSchema,
    prompt,
  })

  let selected = [...new Set(result.object.keep_indices)]
    .filter((i) => i >= 0 && i < history.length)
    .sort((a, b) => a - b)

  // Clamp to [trimMin, trimMax]: if too few, pad with most-recent messages not already selected
  if (selected.length > trimMax) {
    selected = selected.slice(selected.length - trimMax)
  } else if (selected.length < trimMin) {
    const selectedSet = new Set(selected)
    const candidates = Array.from({ length: history.length }, (_, i) => i)
      .filter((i) => !selectedSet.has(i))
      .reverse()
    for (const i of candidates) {
      if (selected.length >= trimMin) break
      selected.push(i)
    }
    selected.sort((a, b) => a - b)
  }

  const trimmedMessages = selected.map((i) => history[i]!)

  log.info(
    {
      retained: trimmedMessages.length,
      dropped: history.length - trimmedMessages.length,
      summaryLength: result.object.summary.length,
    },
    'Memory model trim complete',
  )

  return { trimmedMessages, summary: result.object.summary }
}

// --- Context message builder ---

export function buildMemoryContextMessage(
  summary: string | null,
  facts: readonly MemoryFact[],
): { role: 'system'; content: string } | null {
  const parts: string[] = []

  if (summary !== null && summary.length > 0) {
    parts.push(`Summary: ${summary}`)
  }

  if (facts.length > 0) {
    const lines = facts.map((f) => `- ${f.identifier}: "${f.title}" — last seen ${f.last_seen.slice(0, 10)}`)
    parts.push(`Recently accessed issues:\n${lines.join('\n')}`)
  }

  if (parts.length === 0) {
    return null
  }

  return { role: 'system', content: `=== Memory context ===\n${parts.join('\n\n')}` }
}
