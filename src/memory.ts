import { generateText, Output, type LanguageModel, type ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { getCachedFacts, getCachedSummary, setCachedSummary, clearCachedFacts, upsertCachedFact } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { memorySummary, memoryFacts } from './db/schema.js'
import { logger } from './logger.js'
import type { MemoryFact } from './types/memory.js'

const log = logger.child({ scope: 'memory' })

// --- Summary persistence (now uses cache) ---

export function loadSummary(userId: string): string | null {
  log.debug({ userId }, 'loadSummary called')
  return getCachedSummary(userId)
}

export function saveSummary(userId: string, summary: string): void {
  log.debug({ userId, summaryLength: summary.length }, 'saveSummary called')
  setCachedSummary(userId, summary)
  log.info({ userId, summaryLength: summary.length }, 'Summary saved to cache (DB sync in background)')
}

export function clearSummary(userId: string): void {
  log.debug({ userId }, 'clearSummary called')
  setCachedSummary(userId, '')

  const db = getDrizzleDb()
  db.delete(memorySummary).where(eq(memorySummary.userId, userId)).run()

  log.info({ userId }, 'Summary cleared')
}

// --- Fact persistence (now uses cache) ---

export function loadFacts(userId: string): readonly MemoryFact[] {
  log.debug({ userId }, 'loadFacts called')
  return getCachedFacts(userId)
}

export function upsertFact(userId: string, fact: Omit<MemoryFact, 'last_seen'>): void {
  log.debug({ userId, identifier: fact.identifier }, 'upsertFact called')
  upsertCachedFact(userId, fact)
  log.info({ userId, identifier: fact.identifier }, 'Fact upserted to cache (DB sync in background)')
}

export function clearFacts(userId: string): void {
  log.debug({ userId }, 'clearFacts called')
  clearCachedFacts(userId)

  const db = getDrizzleDb()
  db.delete(memoryFacts).where(eq(memoryFacts.userId, userId)).run()

  log.info({ userId }, 'Facts cleared')
}

// --- Rule-based fact extraction ---

const TaskResultSchema = z.looseObject({
  id: z.string(),
  title: z.string().optional(),
  number: z.number().optional(),
})

const ProjectResultSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
})

// Wrapper to accept SDK result types directly without unsafe assignments
// SDK v5 uses input/output properties typed as any
export function extractFactsFromSdkResults(
  _toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolName: string; output: unknown }>,
): readonly Omit<MemoryFact, 'last_seen'>[] {
  const facts: Omit<MemoryFact, 'last_seen'>[] = []

  for (const result of toolResults) {
    if (['create_task', 'update_task', 'delete_task'].includes(result.toolName)) {
      const parsed = TaskResultSchema.safeParse(result.output)
      if (parsed.success) {
        const label = parsed.data.number === undefined ? parsed.data.id : `#${parsed.data.number}`
        facts.push({
          identifier: label,
          title: parsed.data.title ?? label,
          url: '',
        })
      }
    }

    if (['create_project', 'update_project', 'archive_project'].includes(result.toolName)) {
      const parsed = ProjectResultSchema.safeParse(result.output)
      if (parsed.success) {
        facts.push({
          identifier: `proj:${parsed.data.id}`,
          title: parsed.data.name,
          url: parsed.data.url ?? '',
        })
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

type TrimResult = {
  readonly trimmedMessages: readonly ModelMessage[]
  readonly summary: string
}

const TRIM_PROMPT = `You are a conversation memory manager. The following conversation history has grown too long ({TOTAL} messages).

Your task:
1. Select between 50 and 100 message indices (0-based) to retain verbatim. Choose fewer (~50) when many threads are resolved and the history is repetitive. Choose more (~100) when conversations are active and many topics are still open. Prefer messages about active unresolved Kaneo issues, recent decisions, ongoing threads, and stated preferences. Drop messages about completed tasks, resolved clarifications, and abandoned threads.
2. Write an updated summary (max 200 words) for all messages NOT retained. Incorporate the previous summary. Preserve: task IDs and numbers, project names, decisions, priorities, preferences.

Previous summary:
{PREVIOUS_SUMMARY}

Conversation (index: [role] content):
{MESSAGES}

Return JSON exactly matching the schema.`

function clampIndices(selected: number[], trimMin: number, trimMax: number, historyLength: number): number[] {
  if (selected.length > trimMax) {
    return selected.slice(selected.length - trimMax)
  }
  if (selected.length < trimMin) {
    const selectedSet = new Set(selected)
    const candidates = Array.from({ length: historyLength }, (_, i) => i)
      .filter((i) => !selectedSet.has(i))
      .reverse()
    for (const i of candidates) {
      if (selected.length >= trimMin) break
      selected.push(i)
    }
    selected.sort((a, b) => a - b)
  }
  return selected
}

export async function trimWithMemoryModel(
  history: readonly ModelMessage[],
  trimMin: number,
  trimMax: number,
  previousSummary: string | null,
  model: LanguageModel,
): Promise<TrimResult> {
  log.debug(
    { messageCount: history.length, trimMin, trimMax, hasPrevious: previousSummary !== null },
    'trimWithMemoryModel called',
  )

  const messagesText = history
    .map((m, i) => `${i}: [${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n')

  const prompt = TRIM_PROMPT.replace(/\{TOTAL\}/g, String(history.length))
    .replace('{PREVIOUS_SUMMARY}', previousSummary ?? '(none)')
    .replace('{MESSAGES}', messagesText)

  const result = await generateText({
    model,
    output: Output.object({ schema: TrimResultSchema }),
    prompt,
  })

  const selected = clampIndices(
    [...new Set(result.output.keep_indices)].filter((i) => i >= 0 && i < history.length).sort((a, b) => a - b),
    trimMin,
    trimMax,
    history.length,
  )
  const trimmedMessages = selected.map((i) => history[i]!)

  log.info(
    {
      retained: trimmedMessages.length,
      dropped: history.length - trimmedMessages.length,
      summaryLength: result.output.summary.length,
    },
    'Memory model trim complete',
  )

  return { trimmedMessages, summary: result.output.summary }
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
    parts.push(`Recently accessed Kaneo entities:\n${lines.join('\n')}`)
  }

  if (parts.length === 0) {
    return null
  }

  return { role: 'system', content: `=== Memory context ===\n${parts.join('\n\n')}` }
}
