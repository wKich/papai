import { logger } from '../logger.js'
import { getGroupAdminObservation, listAdminGroupContextsForUser } from './registry.js'
import type { KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:access' })

export type GroupMatchResult =
  | { kind: 'match'; group: KnownGroupContext }
  | { kind: 'ambiguous'; matches: KnownGroupContext[] }
  | { kind: 'not_found' }

const getMatchCandidates = (group: KnownGroupContext): readonly string[] => [
  group.displayName,
  group.parentName ?? '',
  group.parentName === null ? group.displayName : `${group.parentName} / ${group.displayName}`,
]

export function canManageGroupSettings(userId: string, groupId: string): boolean {
  log.debug({ userId, groupId }, 'canManageGroupSettings called')

  const observation = getGroupAdminObservation(groupId, userId)
  const allowed = observation?.isAdmin === true

  log.debug({ userId, groupId, allowed }, 'Evaluated group settings access')
  return allowed
}

export function listManageableGroups(userId: string): KnownGroupContext[] {
  log.debug({ userId }, 'listManageableGroups called')

  const groups = listAdminGroupContextsForUser(userId)

  log.debug({ userId, groupCount: groups.length }, 'Listed manageable groups')
  return groups
}

export function matchManageableGroup(userId: string, query: string): GroupMatchResult {
  const normalized = query.trim().toLowerCase()

  log.debug({ userId, normalizedQuery: normalized }, 'matchManageableGroup called')

  if (normalized.length === 0) {
    return { kind: 'not_found' }
  }

  const groups = listManageableGroups(userId)
  const exactId = groups.find((group) => group.contextId.toLowerCase() === normalized)
  if (exactId !== undefined) {
    return { kind: 'match', group: exactId }
  }

  const matches = groups.filter((group) =>
    getMatchCandidates(group).some((candidate) => candidate.toLowerCase().includes(normalized)),
  )

  if (matches.length === 1) {
    return { kind: 'match', group: matches[0]! }
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', matches }
  }
  return { kind: 'not_found' }
}
