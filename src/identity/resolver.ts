import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { getIdentityMapping, setIdentityMapping } from './mapping.js'
import type { IdentityResolutionResult, UserIdentity } from './types.js'

const log = logger.child({ scope: 'identity:resolver' })

interface SearchResultUser {
  id: string
  login: string
  name?: string
}

interface FoundResultInput {
  providerUserId: string
  providerUserLogin: string | null
  displayName: string | null
}

/**
 * Build found result from identity mapping.
 */
function buildFoundResult(existing: FoundResultInput): Extract<IdentityResolutionResult, { type: 'found' }> {
  const identity: UserIdentity = {
    userId: existing.providerUserId,
    login: existing.providerUserLogin ?? '',
    displayName: existing.displayName ?? '',
  }
  return { type: 'found', identity }
}

/**
 * Search for exact match and store mapping if found.
 */
async function tryStoreExactMatch(
  contextId: string,
  chatUsername: string,
  providerName: string,
  resolver: { searchUsers(q: string, limit?: number): Promise<SearchResultUser[]> },
): Promise<IdentityResolutionResult | null> {
  const users = await resolver.searchUsers(chatUsername, 10)
  const exactMatch = users.find((u: SearchResultUser) => u.login.toLowerCase() === chatUsername.toLowerCase())

  if (exactMatch === undefined) {
    return null
  }

  setIdentityMapping({
    contextId,
    providerName,
    providerUserId: exactMatch.id,
    providerUserLogin: exactMatch.login,
    displayName: exactMatch.name ?? exactMatch.login,
    matchMethod: 'auto',
    confidence: 100,
  })

  log.info({ contextId, login: exactMatch.login }, 'Auto-linked user')
  return {
    type: 'found',
    identity: {
      userId: exactMatch.id,
      login: exactMatch.login,
      displayName: exactMatch.name ?? exactMatch.login,
    },
  }
}

/**
 * Store unmatched mapping and return result.
 */
function storeUnmatched(
  contextId: string,
  providerName: string,
  chatUsername: string,
): Extract<IdentityResolutionResult, { type: 'unmatched' }> {
  setIdentityMapping({
    contextId,
    providerName,
    providerUserId: null,
    providerUserLogin: null,
    displayName: null,
    matchMethod: 'unmatched',
    confidence: 0,
  })

  log.info({ contextId, chatUsername }, 'No exact match for auto-link')
  return {
    type: 'unmatched',
    message: `I couldn't find a user matching '${chatUsername}'. Tell me your login (e.g., 'I'm jsmith').`,
  }
}

/**
 * Resolve "me" reference to actual task tracker user identity.
 * Checks cache first, then attempts auto-link if no mapping exists.
 */
export function resolveMeReference(contextId: string, provider: TaskProvider): IdentityResolutionResult {
  log.debug({ contextId, providerName: provider.name }, 'resolveMeReference called')

  const existing = getIdentityMapping(contextId, provider.name)

  if (existing === null) {
    log.debug({ contextId }, 'No identity mapping exists')
    return {
      type: 'not_found',
      message: "I don't know who you are in the task tracker. Tell me your login (e.g., 'I'm jsmith').",
    }
  }

  if (existing.providerUserId === null) {
    log.debug({ contextId }, 'Identity mapping marked unmatched')
    return {
      type: 'unmatched',
      message: "I couldn't automatically match you. What's your login?",
    }
  }

  const result = buildFoundResult({
    providerUserId: existing.providerUserId,
    providerUserLogin: existing.providerUserLogin,
    displayName: existing.displayName,
  })
  log.debug({ contextId, login: result.identity.login }, 'Identity resolved')
  return result
}

/**
 * Attempt to auto-link based on username match.
 * Called on first interaction in group chats.
 */
export async function attemptAutoLink(
  contextId: string,
  chatUsername: string,
  provider: TaskProvider,
): Promise<IdentityResolutionResult> {
  log.debug({ contextId, chatUsername, providerName: provider.name }, 'attemptAutoLink called')

  if (provider.identityResolver === undefined) {
    log.warn({ providerName: provider.name }, 'Provider has no identity resolver')
    return {
      type: 'not_found',
      message: 'Auto-link not available for this provider.',
    }
  }

  try {
    const result = await tryStoreExactMatch(contextId, chatUsername, provider.name, provider.identityResolver)
    if (result !== null) {
      return result
    }

    return storeUnmatched(contextId, provider.name, chatUsername)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), contextId }, 'Auto-link failed')
    return {
      type: 'not_found',
      message: 'Unable to search for users. Please tell me your login manually.',
    }
  }
}
