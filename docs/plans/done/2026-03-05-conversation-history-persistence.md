# Conversation History Persistence — Two-Tier Memory

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist per-user conversation history in SQLite so chat context survives bot restarts, and implement two-tier memory so long-running conversations retain meaningful context beyond the working memory window without unbounded token cost.

**Tech Stack:** TypeScript, Bun, `bun:sqlite`, Vercel AI SDK `generateText`, Zod v4, pino logging

---

## Architecture

### The Two-Tier Memory Model

A single sliding-window approach forces a hard tradeoff: keep the window large (high token cost per request) or keep it small (lose older context entirely). Two-tier memory breaks this tradeoff:

```
┌─────────────────────────────────────────────────────────┐
│                    LLM context window                    │
│                                                         │
│  [SYSTEM_PROMPT]                                        │
│  [Tier-2 block — summary + facts]  ← injected           │
│  [Tier-1 — up to 100 messages, smart-trimmed to 50-100]  │
│  [Current user message]                                 │
└─────────────────────────────────────────────────────────┘
```

**Tier 1 — Working memory (smart trimming, hard size ceiling):**

- Up to 100 messages kept verbatim (hard ceiling). Every 10 user messages the memory model smart-trims history, selecting 50-100 messages to retain based on topical density — fewer when threads are resolved, more when conversations are actively branching.
- When the window overflows, the memory model reviews the full history, retains messages still relevant to active topics, discards resolved/off-topic exchanges, and produces a summary of what was dropped — all in a single structured call.
- Gives the LLM exact wording, tool calls, and tool results for the turns that still matter.
- Persisted in SQLite `conversation_history` table (survives restarts).

**Tier 2 — Long-term memory (rolling summary + structured facts):**

- When the window overflows and messages would be dropped, those messages are summarised by the LLM and folded into a running prose summary stored in `memory_summary`.
- Key Linear entities (issue identifiers, project names) extracted rule-based from tool results are stored in `memory_facts`.
- Both are injected as a synthetic system message at the top of the messages array on every request.

### Working Memory Limits

| Constant              | Value | Meaning                                                                                                              |
| --------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `WORKING_MEMORY_CAP`  | 100   | Hard ceiling — history is **never allowed to exceed this**; if periodic trim is missed this forces a trim regardless |
| `TRIM_MIN`            | 50    | Lower bound the model is guided to respect — keeps enough context to be useful                                       |
| `TRIM_MAX`            | 100   | Same as `WORKING_MEMORY_CAP`; the model is told not to exceed this                                                   |
| `SMART_TRIM_INTERVAL` | 10    | Trigger a smart trim every N new **user** messages once history grows past `TRIM_MIN`                                |

The memory model decides the exact count within the 50–100 range based on topical relevance. If the current conversation is deep and active, it will retain more (closer to 100). If many threads are resolved, it will compress aggressively (closer to 50).

### Smart Trimming (Periodic — every 10 user messages)

Trimming fires on **two conditions**, whichever comes first:

- **Periodic:** every `SMART_TRIM_INTERVAL` (10) new user messages, once history already exceeds `TRIM_MIN` (50). This keeps cost predictable — the memory model is never called more often than once per 10 user turns.
- **Hard cap:** if history reaches `WORKING_MEMORY_CAP` (100) for any reason. This is a safety net that should rarely trigger in practice.

When triggered, the memory model performs a single `generateObject` call that produces two outputs simultaneously:

1. **`keep_indices`** — which message indices (0-based) from the full history to retain verbatim. The model is instructed to target 50–100 messages depending on topical density — fewer when many threads are resolved, more when conversations are actively branching.
2. **`summary`** — a rolling prose summary updated to incorporate all dropped messages.

Steps:

1. Trim condition met — the full history is passed to the memory model.
2. Memory model returns `{ keep_indices: number[], summary: string }` as structured JSON via `generateObject`.
3. Indices are deduplicated, validated (in range), sorted by original order, and clamped to the `[TRIM_MIN, TRIM_MAX]` range (if the model returns fewer than `TRIM_MIN`, the most recent messages are appended to reach the minimum; if it returns more than `TRIM_MAX`, the oldest excess are dropped).
4. Updated summary is persisted to `memory_summary`.
5. Filtered history is saved to `conversation_history`.
6. **On failure:** degrade gracefully — log a warning, fall back to positional `slice(-WORKING_MEMORY_CAP)`, skip summary update. Never block the conversation.

The memory model is configured via the `memory_model` key (`/set memory_model <name>`), falling back to `openai_model`. The same `openai_key` and `openai_base_url` are reused — both models are assumed to live on the same provider endpoint (e.g. `gpt-4o` + `gpt-4o-mini`, `claude-opus-4-5` + `claude-haiku-4-5`).

### Fact Extraction (Rule-Based, Zero LLM Cost)

After every `generateText` call, scan `result.toolCalls` for known tool names and extract structured entities from the tool _inputs_ (which are deterministic and always JSON):

| Tool             | Extracted fact                                         |
| ---------------- | ------------------------------------------------------ |
| `create_issue`   | `{ identifier, url, title }` from result               |
| `update_issue`   | `{ identifier, url }` — records that it was touched    |
| `get_issue`      | `{ identifier, url, title }` — records it was accessed |
| `create_project` | `{ projectId, name }` from result                      |
| `search_issues`  | Top-3 identifiers + titles from results                |

Facts are upserted by `identifier` (last-write-wins, timestamp updated). The table is capped at 50 rows per user — oldest by `last_seen` are evicted on insert.

### Context Injection Format

```
=== Memory context ===
Summary: You created issue ENG-42 ("Fix login redirect") under the Backend project
on 2026-02-28 and marked it high priority. You later updated ENG-38 status to Done.

Recently accessed issues:
- ENG-42: "Fix login redirect" — last seen 2026-03-01
- ENG-38: "Migrate DB schema" — last seen 2026-02-27
```

Injected as `{ role: 'system', content: '...' }` prepended to the messages array (Vercel AI SDK accepts multiple system messages interleaved with conversation messages).

### Data Flow

```
processMessage(userText)
  │
  ├─ loadHistory(userId)          ← Tier 1 read
  ├─ loadMemoryContext(userId)    ← Tier 2 read (summary + facts)
  ├─ append user message
  ├─ trimAndSummarise(history)    ← async: periodic (every 10 user msgs) or hard cap (100)
  │    ├─ if triggered: trimWithMemoryModel() → { trimmedMessages, summary }
  │    ├─                                     → saveSummary()
  │    └─ return trimmedMessages (or positional slice on failure)
  │
  ├─ callLlm(history, memoryContext)
  │    ├─ generateText({ messages: [memCtxMsg, ...history] })
  │    ├─ extractFacts(toolCalls) → upsertFacts()  ← Tier 2 write
  │    └─ saveHistory([...history, ...response.messages])  ← Tier 1 write
  │
  └─ on error: saveHistory(history.slice(0, -1))   ← Tier 1 rollback
```

---

## Decision Log

| Decision            | Chosen approach                                                  | Rejected alternatives                                                                                                 |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Fact extraction     | Rule-based from tool call inputs/outputs                         | LLM-based extraction (extra call on every turn, flaky)                                                                |
| Trimming trigger    | Every 10 user messages (periodic) + hard cap at 100              | On every message (too costly); only on hard cap (too infrequent for relevance-based selection)                        |
| Trimming strategy   | Memory-model-driven index selection via `generateObject`         | Positional slice (drops oldest regardless of relevance); LLM-rewrite (produces modified messages, harder to validate) |
| Trim failure mode   | Degrade to positional slice, skip summary update                 | Bubble error (blocks conversation)                                                                                    |
| Long-term store     | SQLite (existing infra)                                          | Vector DB — pgvector, Qdrant, SQLite-vec (Phase 6 scope for semantic memo recall)                                     |
| Context injection   | Synthetic system message in `messages[]`                         | Append to `SYSTEM_PROMPT` string (harder to test, grows unbounded)                                                    |
| Working cap         | 100 hard limit; 50–100 model-chosen range; 10-message interval   | 30 (too small for rich task context); trim-on-every-message (excessive model calls)                                   |
| Memory model config | Single `memory_model` key, reuses `openai_key`/`openai_base_url` | Separate `memory_key`/`memory_base_url` (over-engineering; same provider covers all practical cases)                  |

---

## Database Schema

Three tables, all in `papai.db`:

```sql
-- Tier 1: verbatim sliding window
CREATE TABLE IF NOT EXISTS conversation_history (
  user_id  INTEGER PRIMARY KEY,
  messages TEXT NOT NULL          -- JSON array of ModelMessage
);

-- Tier 2: rolling prose summary
CREATE TABLE IF NOT EXISTS memory_summary (
  user_id    INTEGER PRIMARY KEY,
  summary    TEXT NOT NULL,
  updated_at TEXT NOT NULL        -- ISO-8601 UTC
);

-- Tier 2: structured entity facts
CREATE TABLE IF NOT EXISTS memory_facts (
  user_id     INTEGER NOT NULL,
  identifier  TEXT    NOT NULL,   -- e.g. "ENG-42" or "proj:Backend"
  title       TEXT    NOT NULL,
  url         TEXT    NOT NULL DEFAULT '',
  last_seen   TEXT    NOT NULL,   -- ISO-8601 UTC
  PRIMARY KEY (user_id, identifier)
);
```

---

## Task 0: Update `src/config.ts`

**File:** `src/config.ts` (existing)

Add `memory_model` to the `ConfigKey` union and `CONFIG_KEYS` array:

```typescript
export type ConfigKey =
  | 'linear_key'
  | 'linear_team_id'
  | 'openai_key'
  | 'openai_base_url'
  | 'openai_model'
  | 'memory_model'

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'linear_key',
  'linear_team_id',
  'openai_key',
  'openai_base_url',
  'openai_model',
  'memory_model',
]
```

No other changes to `config.ts` — `memory_model` is optional; callers fall back to `openai_model` if it is `null`.

---

## Current State Analysis

### In-Memory `Map` in `src/bot.ts`

```typescript
const conversationHistory = new Map<number, readonly ModelMessage[]>()
```

All history is lost on every process restart. There are four mutation points:

| Location                       | Operation                                                                    | Purpose                                 |
| ------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------- |
| `getOrCreateHistory`           | `conversationHistory.set(userId, [])`                                        | Initialise empty history for new users  |
| `processMessage` (line ~118)   | `conversationHistory.set(userId, history)`                                   | Persist trimmed history before LLM call |
| `callLlm` (line ~106)          | `conversationHistory.set(userId, [...history, ...result.response.messages])` | Append LLM response messages            |
| `processMessage` error handler | `conversationHistory.set(userId, history.slice(0, -1))`                      | Roll back last user message on failure  |

### Existing SQLite Infrastructure

`src/config.ts` already:

- Creates `new Database(process.env['DB_PATH'] ?? 'papai.db')` at module load
- Runs a `CREATE TABLE IF NOT EXISTS` DDL statement
- Uses `db.run` / `db.query` — the same API the new modules will use

### `ModelMessage` Type

`ModelMessage` is the Vercel AI SDK discriminated union. The SDK produces and consumes it as plain JSON-serialisable objects, making round-trip via `JSON.stringify` / `JSON.parse` safe. A minimal Zod schema guards against corrupt rows on read; the full message structure is trusted because we wrote it ourselves.

---

## Task 1: Create `src/history.ts`

**File:** `src/history.ts` (new) — Tier 1 working memory persistence.

```typescript
import { Database } from 'bun:sqlite'
import { type ModelMessage } from 'ai'
import { z } from 'zod'

import { logger } from './logger.js'

const log = logger.child({ scope: 'history' })

const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'
const db = new Database(DB_PATH)
db.run('PRAGMA journal_mode=WAL')
db.run('CREATE TABLE IF NOT EXISTS conversation_history (user_id INTEGER PRIMARY KEY, messages TEXT NOT NULL)')

// Minimal validation — we trust our own serialisation but guard against corrupt rows.
const PersistedMessageSchema = z.object({ role: z.string() }).passthrough()
const HistoryRowSchema = z.object({ messages: z.string() })

export function loadHistory(userId: number): readonly ModelMessage[] {
  log.debug({ userId }, 'loadHistory called')
  const row = db
    .query<{ messages: string }, [number]>('SELECT messages FROM conversation_history WHERE user_id = ?')
    .get(userId)

  if (row === null) {
    log.debug({ userId }, 'No persisted history found')
    return []
  }

  const parsed = HistoryRowSchema.safeParse(row)
  if (!parsed.success) {
    log.warn({ userId, error: parsed.error.message }, 'Corrupt history row — resetting')
    return []
  }

  try {
    const raw: unknown = JSON.parse(parsed.data.messages)
    const validated = z.array(PersistedMessageSchema).parse(raw)
    log.info({ userId, messageCount: validated.length }, 'History loaded')
    return validated as readonly ModelMessage[]
  } catch (error) {
    log.warn(
      { userId, error: error instanceof Error ? error.message : String(error) },
      'Failed to parse history JSON — resetting',
    )
    return []
  }
}

export function saveHistory(userId: number, messages: readonly ModelMessage[]): void {
  log.debug({ userId, messageCount: messages.length }, 'saveHistory called')
  db.run('INSERT OR REPLACE INTO conversation_history (user_id, messages) VALUES (?, ?)', [
    userId,
    JSON.stringify(messages),
  ])
  log.info({ userId, messageCount: messages.length }, 'History saved')
}

export function clearHistory(userId: number): void {
  log.debug({ userId }, 'clearHistory called')
  db.run('DELETE FROM conversation_history WHERE user_id = ?', [userId])
  log.info({ userId }, 'History cleared')
}
```

**Rationale for `PRAGMA journal_mode=WAL`:** The default SQLite journal mode (DELETE) can produce "database is locked" errors when multiple connections are open simultaneously (config.ts, history.ts, and memory.ts each open their own `Database` instance). WAL mode allows concurrent readers and a single writer without blocking.

---

## Task 2: Create `src/memory.ts`

**File:** `src/memory.ts` (new) — Tier 2 long-term memory: rolling summary + structured fact store.

### Step 1: Database setup and types

```typescript
import { Database } from 'bun:sqlite'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { type ModelMessage } from 'ai'
import { z } from 'zod'

import { logger } from './logger.js'

const log = logger.child({ scope: 'memory' })

const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'
const db = new Database(DB_PATH)
db.run('PRAGMA journal_mode=WAL')
db.run(`
  CREATE TABLE IF NOT EXISTS memory_summary (
    user_id    INTEGER PRIMARY KEY,
    summary    TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)
db.run(`
  CREATE TABLE IF NOT EXISTS memory_facts (
    user_id    INTEGER NOT NULL,
    identifier TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    url        TEXT    NOT NULL DEFAULT '',
    last_seen  TEXT    NOT NULL,
    PRIMARY KEY (user_id, identifier)
  )
`)

const FACTS_CAP = 50 // max facts per user

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
```

### Step 2: Summary persistence

```typescript
export function loadSummary(userId: number): string | null {
  log.debug({ userId }, 'loadSummary called')
  const row = db
    .query<{ summary: string }, [number]>('SELECT summary FROM memory_summary WHERE user_id = ?')
    .get(userId)
  return row?.summary ?? null
}

export function saveSummary(userId: number, summary: string): void {
  log.debug({ userId, summaryLength: summary.length }, 'saveSummary called')
  db.run('INSERT OR REPLACE INTO memory_summary (user_id, summary, updated_at) VALUES (?, ?, ?)', [
    userId,
    summary,
    new Date().toISOString(),
  ])
  log.info({ userId, summaryLength: summary.length }, 'Summary saved')
}

export function clearSummary(userId: number): void {
  log.debug({ userId }, 'clearSummary called')
  db.run('DELETE FROM memory_summary WHERE user_id = ?', [userId])
  log.info({ userId }, 'Summary cleared')
}
```

### Step 3: Fact persistence

```typescript
export function loadFacts(userId: number): readonly MemoryFact[] {
  log.debug({ userId }, 'loadFacts called')
  const rows = db
    .query<
      MemoryFact,
      [number]
    >('SELECT identifier, title, url, last_seen FROM memory_facts WHERE user_id = ? ORDER BY last_seen DESC')
    .all(userId)
  return rows
}

export function upsertFact(userId: number, fact: Omit<MemoryFact, 'last_seen'>): void {
  log.debug({ userId, identifier: fact.identifier }, 'upsertFact called')
  const now = new Date().toISOString()
  db.run('INSERT OR REPLACE INTO memory_facts (user_id, identifier, title, url, last_seen) VALUES (?, ?, ?, ?, ?)', [
    userId,
    fact.identifier,
    fact.title,
    fact.url,
    now,
  ])
  // Evict oldest facts beyond cap
  db.run(
    `DELETE FROM memory_facts WHERE user_id = ? AND identifier NOT IN (
      SELECT identifier FROM memory_facts WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?
    )`,
    [userId, userId, FACTS_CAP],
  )
  log.info({ userId, identifier: fact.identifier }, 'Fact upserted')
}

export function clearFacts(userId: number): void {
  log.debug({ userId }, 'clearFacts called')
  db.run('DELETE FROM memory_facts WHERE user_id = ?', [userId])
  log.info({ userId }, 'Facts cleared')
}
```

### Step 4: Rule-based fact extraction

Extract facts from tool call inputs/outputs without any extra LLM call. Tool names and result shapes are known statically.

```typescript
type ToolCallEntry = { toolName: string; args: Record<string, unknown> }
type ToolResultEntry = { toolName: string; result: unknown }

const IssueResultSchema = z
  .object({
    identifier: z.string(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough()

export function extractFacts(
  toolCalls: readonly ToolCallEntry[],
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
```

### Step 5: Smart trimming with memory model

Uses `generateObject` (Vercel AI SDK) to get a structured `{ keep_indices, summary }` response in a single call.

```typescript
import { generateObject } from 'ai'

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

  const trimmedMessages = selected.map((i) => history[i])

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
```

### Step 6: Context message builder

```typescript
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
```

---

## Task 3: Modify `src/bot.ts`

**File:** `src/bot.ts` (existing)

### Step 1: Replace in-memory Map, add imports

Remove:

```typescript
const conversationHistory = new Map<number, readonly ModelMessage[]>()
```

Add to imports:

```typescript
import { clearHistory, loadHistory, saveHistory } from './history.js'
import {
  buildMemoryContextMessage,
  clearFacts,
  clearSummary,
  extractFacts,
  loadFacts,
  loadSummary,
  saveSummary,
  trimWithMemoryModel,
  upsertFact,
} from './memory.js'
```

### Step 2: Update `getOrCreateHistory`

Replace the entire function with:

```typescript
const getOrCreateHistory = (userId: number): readonly ModelMessage[] => {
  log.debug({ userId }, 'getOrCreateHistory called')
  const history = loadHistory(userId)
  log.debug({ userId, messageCount: history.length }, 'Conversation history loaded')
  if (history.length === 0) {
    log.info({ userId }, 'No existing conversation history')
  }
  return history
}
```

### Step 3: Update `trimHistory` → `trimAndSummarise` (async)

Replace the synchronous `trimHistory` with an async version that uses the memory model to intelligently select which messages to retain:

```typescript
const WORKING_MEMORY_CAP = 100 // hard ceiling — never exceed this
const TRIM_MIN = 50 // lower bound of range the memory model targets
const TRIM_MAX = 100 // upper bound of range (same as hard cap)
const SMART_TRIM_INTERVAL = 10 // trigger every N new user messages

const trimAndSummarise = async (history: readonly ModelMessage[], userId: number): Promise<readonly ModelMessage[]> => {
  log.debug({ userId, historyLength: history.length }, 'trimAndSummarise called')

  const userMessageCount = history.filter((m) => m.role === 'user').length
  const periodicTrim = userMessageCount > 0 && userMessageCount % SMART_TRIM_INTERVAL === 0 && history.length > TRIM_MIN
  const hardCapTrim = history.length >= WORKING_MEMORY_CAP

  if (!periodicTrim && !hardCapTrim) {
    return history
  }

  const reason = hardCapTrim ? 'hard cap reached' : `periodic (${userMessageCount} user messages)`
  log.warn({ userId, historyLength: history.length, reason }, 'Smart trim triggered')

  const openaiKey = getConfig('openai_key')
  const openaiBaseUrl = getConfig('openai_base_url')
  const openaiModel = getConfig('openai_model')
  // Use dedicated memory_model if configured; fall back to the main model.
  const memoryModel = getConfig('memory_model') ?? openaiModel

  if (openaiKey !== null && openaiBaseUrl !== null && memoryModel !== null) {
    try {
      const existing = loadSummary(userId)
      const { trimmedMessages, summary } = await trimWithMemoryModel(history, TRIM_MIN, TRIM_MAX, existing, {
        apiKey: openaiKey,
        baseUrl: openaiBaseUrl,
        model: memoryModel,
      })
      saveSummary(userId, summary)
      log.info({ userId, retained: trimmedMessages.length }, 'Smart trim complete')
      return trimmedMessages
    } catch (error) {
      log.warn(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Smart trim failed — falling back to positional slice',
      )
    }
  } else {
    log.warn({ userId }, 'LLM config not available — falling back to positional slice')
  }

  // Fallback: keep the most recent messages within hard limit
  return history.slice(-WORKING_MEMORY_CAP)
}
```

### Step 4: Update `callLlm` — inject memory context + extract facts

Inject the Tier 2 context block as a synthetic system message and extract facts from tool call results:

```typescript
// Inside callLlm, before the generateText call:
const summary = loadSummary(userId)
const facts = loadFacts(userId)
const memoryMsg = buildMemoryContextMessage(summary, facts)
const messagesWithMemory = memoryMsg !== null ? [memoryMsg, ...history] : [...history]

log.debug({ userId, historyLength: history.length, hasMemory: memoryMsg !== null }, 'Calling generateText')
const result = await generateText({
  model,
  system: SYSTEM_PROMPT,
  messages: messagesWithMemory,
  tools,
  stopWhen: stepCountIs(25),
})

// After generateText — extract and persist facts:
const toolCallEntries = result.toolCalls.map((tc) => ({
  toolName: tc.toolName,
  args: tc.args as Record<string, unknown>,
}))
const toolResultEntries = result.toolResults.map((tr) => ({ toolName: tr.toolName, result: tr.result }))
const newFacts = extractFacts(toolCallEntries, toolResultEntries)
for (const fact of newFacts) {
  upsertFact(userId, fact)
}
if (newFacts.length > 0) {
  log.info({ userId, factsExtracted: newFacts.length }, 'Facts extracted and persisted')
}

saveHistory(userId, [...history, ...result.response.messages])
```

### Step 5: Update `processMessage` — await trimAndSummarise, save trimmed history

```typescript
const history = await trimAndSummarise([...getOrCreateHistory(userId), { role: 'user', content: userText }], userId)
saveHistory(userId, history)
```

### Step 6: Rollback on error

```typescript
// In the catch block — rollback working memory only:
saveHistory(userId, history.slice(0, -1))
```

### Step 7: Update `/clear` command — wipe all three tiers

```typescript
bot.command('clear', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId)) {
    return
  }
  log.debug({ userId }, '/clear command called')
  clearHistory(userId)
  clearSummary(userId)
  clearFacts(userId)
  log.info({ userId }, '/clear command executed — all memory tiers cleared')
  await ctx.reply('Conversation history and memory cleared.')
})
```

---

## Task 4: Create `src/history.test.ts`

Follow the exact pattern from `src/config.test.ts` — mock `bun:sqlite` before importing module under test.

```typescript
import { mock } from 'bun:test'

const mockStore = new Map<number, string>()

mock.module('bun:sqlite', () => ({
  Database: class MockDatabase {
    run(_sql: string, _params?: unknown[]) {}
    query(sql: string) {
      if (sql.includes('SELECT messages FROM conversation_history')) {
        return {
          get: (userId: number) => {
            const messages = mockStore.get(userId)
            return messages !== undefined ? { messages } : null
          },
        }
      }
      return { get: () => null, all: () => [] }
    }
  },
}))

import { describe, expect, test, beforeEach } from 'bun:test'
import { clearHistory, loadHistory, saveHistory } from './history.js'
```

**Test cases:**

| Test                         | Scenario                  | Expected                                        |
| ---------------------------- | ------------------------- | ----------------------------------------------- |
| `loadHistory` — no row       | `mockStore` empty         | Returns `[]`                                    |
| `loadHistory` — valid row    | Valid serialised messages | Returns deserialised `ModelMessage[]`           |
| `loadHistory` — corrupt JSON | `"not-json"` in store     | Returns `[]`, logs warn                         |
| `loadHistory` — missing role | `[{}]` in store           | Returns `[]` (Zod failure), logs warn           |
| `saveHistory`                | Called with messages      | `db.run` receives `INSERT OR REPLACE` with JSON |
| `clearHistory`               | Called with userId        | `db.run` receives `DELETE` statement            |

---

## Task 5: Create `src/memory.test.ts`

```typescript
import { mock } from 'bun:test'

const mockSummaryStore = new Map<number, string>()
const mockFactsStore = new Map<string, unknown>()

mock.module('bun:sqlite', () => ({
  Database: class MockDatabase {
    run(_sql: string, _params?: unknown[]) {}
    query(sql: string) {
      if (sql.includes('SELECT summary FROM memory_summary')) {
        return {
          get: (userId: number) => {
            const s = mockSummaryStore.get(userId)
            return s !== undefined ? { summary: s } : null
          },
        }
      }
      if (sql.includes('SELECT identifier, title')) {
        return { all: () => [] }
      }
      return { get: () => null, all: () => [] }
    }
  },
}))

mock.module('ai', () => ({
  generateObject: mock(async () => ({ object: { keep_indices: [0, 1], summary: 'Updated summary text' } })),
}))

import { describe, expect, test } from 'bun:test'
import { buildMemoryContextMessage, extractFacts, loadSummary, saveSummary, trimWithMemoryModel } from './memory.js'
```

**Test cases:**

| Test                                          | Scenario                                               | Expected                                             |
| --------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `loadSummary` — no row                        | Store empty                                            | Returns `null`                                       |
| `loadSummary` — has row                       | Store has summary                                      | Returns summary string                               |
| `saveSummary`                                 | Called                                                 | `db.run` receives correct SQL                        |
| `buildMemoryContextMessage` — both null/empty | `null` summary, `[]` facts                             | Returns `null`                                       |
| `buildMemoryContextMessage` — summary only    | Summary, no facts                                      | Returns system message containing summary            |
| `buildMemoryContextMessage` — facts only      | No summary, facts                                      | Returns system message with issue list               |
| `buildMemoryContextMessage` — both            | Summary + facts                                        | Returns combined block                               |
| `extractFacts` — create_issue                 | Tool result with identifier+title                      | Returns one fact                                     |
| `extractFacts` — search_issues                | Array result                                           | Returns up to 3 facts                                |
| `extractFacts` — unknown tool                 | Unrecognised tool name                                 | Returns `[]`                                         |
| `trimWithMemoryModel` — normal                | Mock returns `{ keep_indices: [0,2], summary: '...' }` | Returns `{ trimmedMessages: [msg0, msg2], summary }` |
| `trimWithMemoryModel` — out-of-range indices  | Mock returns indices beyond history length             | Invalid indices are silently filtered out            |
| `trimWithMemoryModel` — duplicate indices     | Mock returns `[1, 1, 2]`                               | Deduplicates; returns `[msg1, msg2]`                 |
| `trimWithMemoryModel` — below TRIM_MIN        | Mock returns only 2 indices with 10-msg history        | Most-recent messages are appended to reach TRIM_MIN  |
| `trimWithMemoryModel` — above TRIM_MAX        | Mock returns 105 indices                               | Oldest excess dropped; result capped at TRIM_MAX     |

---

## Task 6: Update `ROADMAP.md`

Mark the item as complete:

```markdown
- [x] Conversation history persistence — SQLite-backed two-tier memory: smart-trimmed working window (50-100 messages, memory-model-selected) + rolling summary + structured Linear entity facts
```

---

## Out of Scope

- History expiry / TTL (plaintext local bot, not required)
- Encrypting stored messages (local personal bot, SQLite file permissions are sufficient)
- Separate summary model config key (noted as future optimisation — use same model for now)
- Vector/semantic recall (Phase 6 scope — memo `recall` tool is the right home for this)

---

## Risk Assessment

| Risk                                                | Probability | Impact | Mitigation                                                                                          |
| --------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------- |
| Smart trim adds latency on overflow events          | Medium      | Low    | Overflow is infrequent (every 10 user messages once past 50); user sees no UX difference            |
| `trimWithMemoryModel` fails (LLM error, bad JSON)   | Low         | Low    | Graceful degradation: log warn, fall back to positional slice                                       |
| Memory model returns all indices or zero indices    | Low         | Low    | Hard cap enforced post-validation (`slice(0, cap)`); empty result falls through to positional slice |
| `ModelMessage` structure changes in future `ai` SDK | Low         | Medium | `passthrough()` in Zod preserves unknown fields; only structural breaks would cascade               |
| SQLite “database is locked” (three connections)     | Low         | High   | `PRAGMA journal_mode=WAL` on all three modules (`config`, `history`, `memory`)                      |
| Injected memory context exceeds context window      | Low         | Medium | Summary capped at 200 words; facts capped at 50 rows; total injection well under 1k tokens          |
| Stale facts mislead LLM                             | Low         | Low    | Facts include `last_seen` date; summary is rolling and self-correcting                              |

---

## Verification Checklist

- [ ] `bun run start` — send messages, restart, send another; LLM references prior context
- [ ] After 50+ messages: summary is generated and visible in `papai.db` `memory_summary` table
- [ ] `/clear` wipes all three tables (`conversation_history`, `memory_summary`, `memory_facts`)
- [ ] After `create_issue`: `memory_facts` contains the new issue identifier
- [ ] Summary generation failure: LLM error path → history is still trimmed, bot still responds
- [ ] `bun test` — all tests pass including `history.test.ts` and `memory.test.ts`
- [ ] `bun run lint` — no lint errors
- [ ] First run (no `papai.db`): all three tables are created automatically

Replace:

```typescript
conversationHistory.set(userId, history)
```

With:

```typescript
saveHistory(userId, history)
```

### Step 5: Update `processMessage` error handler — rollback

Replace:

```typescript
conversationHistory.set(userId, history.slice(0, -1))
```

With:

```typescript
saveHistory(userId, history.slice(0, -1))
```

### Step 6: Add `/clear` command

Add before `bot.on('message:text', ...)`:

```typescript
bot.command('clear', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId)) {
    return
  }
  log.debug({ userId }, '/clear command called')
  clearHistory(userId)
  log.info({ userId }, '/clear command executed')
  await ctx.reply('Conversation history cleared.')
})
```

**Rationale:** Without a `/clear` command the user has no way to reset context after a restart — the old history will always be reloaded. This is a minimal, necessary companion to persistence.

---

## Task 3: Create `src/history.test.ts`

**File:** `src/history.test.ts` (new)

Follow the exact pattern from `src/config.test.ts` — mock `bun:sqlite` before importing module under test.

```typescript
import { mock } from 'bun:test'

// --- bun:sqlite mock (must come before importing history.ts) ---
const mockStore = new Map<number, string>()

mock.module('bun:sqlite', () => ({
  Database: class MockDatabase {
    run(_sql: string, _params?: unknown[]) {
      // PRAGMA and CREATE TABLE: no-op
    }
    query(sql: string) {
      if (sql.includes('SELECT messages FROM conversation_history')) {
        return {
          get: (userId: number) => {
            const messages = mockStore.get(userId)
            return messages !== undefined ? { messages } : null
          },
        }
      }
      return { get: () => null, all: () => [] }
    }
  },
}))
// --- end mock ---

import { describe, expect, test, beforeEach, spyOn } from 'bun:test'
import { loadHistory, saveHistory, clearHistory } from './history.js'
```

**Test cases:**

| Test                         | Scenario                            | Expected outcome                                        |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `loadHistory` — no row       | `mockStore` is empty                | Returns `[]`                                            |
| `loadHistory` — valid row    | `mockStore` has serialised messages | Returns deserialised `ModelMessage[]`                   |
| `loadHistory` — corrupt JSON | `mockStore` has `"not-json"`        | Returns `[]`, emits `logger.warn`                       |
| `loadHistory` — missing role | Row has `[{}]`                      | Returns `[]` (Zod parse failure), emits `logger.warn`   |
| `saveHistory`                | Called with messages                | `db.run` receives `INSERT OR REPLACE` with JSON payload |
| `clearHistory`               | Called with userId                  | `db.run` receives `DELETE` statement                    |

For `saveHistory` and `clearHistory` tests, intercept via a captured reference to `MockDatabase` to assert the correct SQL is called.
