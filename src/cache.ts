import { type ModelMessage } from 'ai'
import { sql } from 'drizzle-orm'

import { syncConfigToDb, syncFactToDb, syncHistoryToDb, syncSummaryToDb, syncWorkspaceToDb } from './cache-db.js'
import { parseHistoryFromDb } from './cache-helpers.js'
import { getDrizzleDb } from './db/drizzle.js'
import { conversationHistory, memoryFacts, memorySummary, userConfig, users } from './db/schema.js'
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

const userCaches = new Map<string, UserCache>()

/**
 * Exported for testing purposes only.
 * @internal
 */
export const _userCaches = userCaches

const SESSION_TTL_MS = 30 * 60 * 1000

setInterval(
  () => {
    const now = Date.now()
    const expired: string[] = []
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

function getOrCreateCache(userId: string): UserCache {
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

export function getCachedHistory(userId: string): readonly ModelMessage[] {
  const cache = getOrCreateCache(userId)
  if (cache.history.length === 0) {
    log.debug({ userId }, 'Loading history from DB into cache')
    const row = getDrizzleDb()
      .select({ messages: conversationHistory.messages })
      .from(conversationHistory)
      .where(sql`${conversationHistory.userId} = ${userId}`)
      .get()
    if (row?.messages !== undefined) {
      const parsed = parseHistoryFromDb(row.messages)
      if (parsed !== null) {
        cache.history = parsed
      }
    }
  }
  return cache.history
}

export function setCachedHistory(userId: string, messages: readonly ModelMessage[]): void {
  const cache = getOrCreateCache(userId)
  cache.history = [...messages]
  syncHistoryToDb(userId, cache.history)
}

export function appendToCachedHistory(userId: string, messages: readonly ModelMessage[]): void {
  const cache = getOrCreateCache(userId)
  cache.history.push(...messages)
  syncHistoryToDb(userId, cache.history)
}

// --- Summary Cache ---

export function getCachedSummary(userId: string): string | null {
  const cache = getOrCreateCache(userId)
  if (cache.summary === null && !cache.config.has('summary_loaded')) {
    log.debug({ userId }, 'Loading summary from DB into cache')
    const row = getDrizzleDb()
      .select({ summary: memorySummary.summary })
      .from(memorySummary)
      .where(sql`${memorySummary.userId} = ${userId}`)
      .get()
    cache.summary = row?.summary ?? null
    cache.config.set('summary_loaded', 'true')
  }
  return cache.summary
}

export function setCachedSummary(userId: string, summary: string): void {
  const cache = getOrCreateCache(userId)
  cache.summary = summary
  syncSummaryToDb(userId, summary)
}

// --- Facts Cache ---

export function getCachedFacts(
  userId: string,
): readonly { identifier: string; title: string; url: string; last_seen: string }[] {
  const cache = getOrCreateCache(userId)
  if (cache.facts.length === 0 && !cache.config.has('facts_loaded')) {
    log.debug({ userId }, 'Loading facts from DB into cache')
    const rows = getDrizzleDb()
      .select({
        identifier: memoryFacts.identifier,
        title: memoryFacts.title,
        url: memoryFacts.url,
        last_seen: memoryFacts.lastSeen,
      })
      .from(memoryFacts)
      .where(sql`${memoryFacts.userId} = ${userId}`)
      .orderBy(sql`${memoryFacts.lastSeen} DESC`)
      .all()
    cache.facts = rows
    cache.config.set('facts_loaded', 'true')
  }
  return cache.facts
}

export function upsertCachedFact(userId: string, fact: { identifier: string; title: string; url: string }): void {
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

export function getCachedConfig(userId: string, key: string): string | null {
  const cache = getOrCreateCache(userId)
  if (!cache.config.has(key)) {
    log.debug({ userId, key }, 'Loading config from DB into cache')
    const row = getDrizzleDb()
      .select({ value: userConfig.value })
      .from(userConfig)
      .where(sql`${userConfig.userId} = ${userId} AND ${userConfig.key} = ${key}`)
      .get()
    cache.config.set(key, row?.value ?? null)
  }
  return cache.config.get(key) ?? null
}

export function setCachedConfig(userId: string, key: string, value: string): void {
  const cache = getOrCreateCache(userId)
  cache.config.set(key, value)
  syncConfigToDb(userId, key, value)
}

// --- Workspace Cache ---

export function getCachedWorkspace(userId: string): string | null {
  const cache = getOrCreateCache(userId)
  if (cache.workspaceId === null && !cache.config.has('workspace_loaded')) {
    log.debug({ userId }, 'Loading workspace from DB into cache')
    const row = getDrizzleDb()
      .select({ kaneoWorkspaceId: users.kaneoWorkspaceId })
      .from(users)
      .where(sql`${users.platformUserId} = ${userId}`)
      .get()
    cache.workspaceId = row?.kaneoWorkspaceId ?? null
    cache.config.set('workspace_loaded', 'true')
  }
  return cache.workspaceId
}

export function setCachedWorkspace(userId: string, workspaceId: string): void {
  const cache = getOrCreateCache(userId)
  cache.workspaceId = workspaceId
  syncWorkspaceToDb(userId, workspaceId)
}

// --- Tools Cache ---

export function getCachedTools(userId: string): unknown {
  const tools = getOrCreateCache(userId).tools
  return tools === null ? undefined : tools
}

export function setCachedTools(userId: string, tools: unknown): void {
  getOrCreateCache(userId).tools = tools
}

export function clearCachedTools(userId: string): void {
  getOrCreateCache(userId).tools = null
}

export function clearCachedFacts(userId: string): void {
  const cache = userCaches.get(userId)
  if (cache === undefined) {
    log.debug({ userId }, 'No facts cache to clear (cache not initialized)')
    return
  }
  cache.facts = []
  cache.config.delete('facts_loaded')
  log.debug({ userId }, 'Facts cache cleared')
}
