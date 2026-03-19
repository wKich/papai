import { type ModelMessage } from 'ai'

import { syncConfigToDb, syncFactToDb, syncHistoryToDb, syncSummaryToDb, syncWorkspaceToDb } from './cache-db.js'
import { parseHistoryFromDb } from './cache-helpers.js'
import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'cache' })

// --- User Session Cache ---

type UserCache = {
  history: ModelMessage[]
  summary: string | null
  facts: Array<{ identifier: string; title: string; url: string; last_seen: string }>
  config: Map<string, string | null>
  workspaceId: string | null
  tools: unknown
  lastAccessed: number
}

const userCaches = new Map<number, UserCache>()

/**
 * Exported for testing purposes only.
 * @internal
 */
export const _userCaches = userCaches

const SESSION_TTL_MS = 30 * 60 * 1000

setInterval(
  () => {
    const now = Date.now()
    const expired: number[] = []
    for (const [userId, cache] of userCaches) {
      if (now - cache.lastAccessed > SESSION_TTL_MS) {
        expired.push(userId)
      }
    }
    for (const userId of expired) {
      userCaches.delete(userId)
      log.debug({ userId }, 'Expired user cache removed')
    }
    if (expired.length > 0) {
      log.info({ expiredCount: expired.length }, 'Cleaned up expired user caches')
    }
  },
  5 * 60 * 1000,
)

function getOrCreateCache(userId: number): UserCache {
  let cache = userCaches.get(userId)
  if (cache === undefined) {
    cache = {
      history: [],
      summary: null,
      facts: [],
      config: new Map(),
      workspaceId: null,
      tools: null,
      lastAccessed: Date.now(),
    }
    userCaches.set(userId, cache)
  }
  cache.lastAccessed = Date.now()
  return cache
}

// --- History Cache ---

export function getCachedHistory(userId: number): readonly ModelMessage[] {
  const cache = getOrCreateCache(userId)
  if (cache.history.length === 0) {
    log.debug({ userId }, 'Loading history from DB into cache')
    const row = getDb()
      .query<{ messages: string }, [number]>('SELECT messages FROM conversation_history WHERE user_id = ?')
      .get(userId)
    if (row?.messages !== undefined) {
      const parsed = parseHistoryFromDb(row.messages)
      if (parsed !== null) {
        cache.history = parsed
      }
    }
  }
  return cache.history
}

export function setCachedHistory(userId: number, messages: readonly ModelMessage[]): void {
  const cache = getOrCreateCache(userId)
  cache.history = [...messages]
  syncHistoryToDb(userId, cache.history)
}

export function appendToCachedHistory(userId: number, messages: readonly ModelMessage[]): void {
  const cache = getOrCreateCache(userId)
  cache.history.push(...messages)
  syncHistoryToDb(userId, cache.history)
}

// --- Summary Cache ---

export function getCachedSummary(userId: number): string | null {
  const cache = getOrCreateCache(userId)
  if (cache.summary === null && !cache.config.has('summary_loaded')) {
    log.debug({ userId }, 'Loading summary from DB into cache')
    const row = getDb()
      .query<{ summary: string }, [number]>('SELECT summary FROM memory_summary WHERE user_id = ?')
      .get(userId)
    cache.summary = row?.summary ?? null
    cache.config.set('summary_loaded', 'true')
  }
  return cache.summary
}

export function setCachedSummary(userId: number, summary: string): void {
  const cache = getOrCreateCache(userId)
  cache.summary = summary
  syncSummaryToDb(userId, summary)
}

// --- Facts Cache ---

export function getCachedFacts(
  userId: number,
): readonly { identifier: string; title: string; url: string; last_seen: string }[] {
  const cache = getOrCreateCache(userId)
  if (cache.facts.length === 0 && !cache.config.has('facts_loaded')) {
    log.debug({ userId }, 'Loading facts from DB into cache')
    const rows = getDb()
      .query<{ identifier: string; title: string; url: string; last_seen: string }, [number]>(
        'SELECT identifier, title, url, last_seen FROM memory_facts WHERE user_id = ? ORDER BY last_seen DESC',
      )
      .all(userId)
    cache.facts = rows
    cache.config.set('facts_loaded', 'true')
  }
  return cache.facts
}

export function upsertCachedFact(userId: number, fact: { identifier: string; title: string; url: string }): void {
  const cache = getOrCreateCache(userId)
  const now = new Date().toISOString()
  const existingIndex = cache.facts.findIndex((f) => f.identifier === fact.identifier)
  if (existingIndex >= 0) {
    cache.facts[existingIndex] = { ...fact, last_seen: now }
  } else {
    cache.facts.unshift({ ...fact, last_seen: now })
    if (cache.facts.length > 50) {
      cache.facts = cache.facts.slice(0, 50)
    }
  }
  syncFactToDb(userId, fact, now)
}

// --- Config Cache ---

export function getCachedConfig(userId: number, key: string): string | null {
  const cache = getOrCreateCache(userId)
  if (!cache.config.has(key)) {
    log.debug({ userId, key }, 'Loading config from DB into cache')
    const row = getDb()
      .query<{ value: string }, [number, string]>('SELECT value FROM user_config WHERE user_id = ? AND key = ?')
      .get(userId, key)
    cache.config.set(key, row?.value ?? null)
  }
  return cache.config.get(key) ?? null
}

export function setCachedConfig(userId: number, key: string, value: string): void {
  const cache = getOrCreateCache(userId)
  cache.config.set(key, value)
  syncConfigToDb(userId, key, value)
}

// --- Workspace Cache ---

export function getCachedWorkspace(userId: number): string | null {
  const cache = getOrCreateCache(userId)
  if (cache.workspaceId === null && !cache.config.has('workspace_loaded')) {
    log.debug({ userId }, 'Loading workspace from DB into cache')
    const row = getDb()
      .query<{ kaneo_workspace_id: string | null }, [number]>(
        'SELECT kaneo_workspace_id FROM users WHERE telegram_id = ?',
      )
      .get(userId)
    cache.workspaceId = row?.kaneo_workspace_id ?? null
    cache.config.set('workspace_loaded', 'true')
  }
  return cache.workspaceId
}

export function setCachedWorkspace(userId: number, workspaceId: string): void {
  const cache = getOrCreateCache(userId)
  cache.workspaceId = workspaceId
  syncWorkspaceToDb(userId, workspaceId)
}

// --- Tools Cache ---

export function getCachedTools(userId: number): unknown {
  const tools = getOrCreateCache(userId).tools
  return tools === null ? undefined : tools
}

export function setCachedTools(userId: number, tools: unknown): void {
  getOrCreateCache(userId).tools = tools
}

export function clearCachedTools(userId: number): void {
  getOrCreateCache(userId).tools = null
}

export function clearCachedFacts(userId: number): void {
  const cache = userCaches.get(userId)
  if (cache === undefined) {
    log.debug({ userId }, 'No facts cache to clear (cache not initialized)')
    return
  }
  cache.facts = []
  cache.config.delete('facts_loaded')
  log.debug({ userId }, 'Facts cache cleared')
}
