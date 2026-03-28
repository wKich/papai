import { _userCaches } from './cache.js'

export type SessionSnapshot = {
  userId: string
  lastAccessed: number
  historyLength: number
  summary: string | null
  factsCount: number
  facts: ReadonlyArray<{ identifier: string; title: string; url: string; lastSeen: string }>
  configKeys: string[]
  workspaceId: string | null
  hasTools: boolean
  instructionsCount: number
}

export function getSessionSnapshots(userId: string): SessionSnapshot[] {
  const snapshots: SessionSnapshot[] = []
  for (const [id, cache] of _userCaches) {
    if (id !== userId) continue
    const configKeys: string[] = []
    for (const [key, value] of cache.config) {
      if (value !== null && !key.endsWith('_loaded')) configKeys.push(key)
    }
    snapshots.push({
      userId: id,
      lastAccessed: cache.lastAccessed,
      historyLength: cache.history.length,
      summary: cache.summary,
      factsCount: cache.facts.length,
      facts: cache.facts.map((f) => ({
        identifier: f.identifier,
        title: f.title,
        url: f.url,
        lastSeen: f.last_seen,
      })),
      configKeys,
      workspaceId: cache.workspaceId,
      hasTools: cache.tools !== null,
      instructionsCount: cache.instructions?.length ?? 0,
    })
  }
  return snapshots
}
