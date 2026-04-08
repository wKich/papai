import { z } from 'zod'

import { providerError } from '../../../errors.js'
import { logger } from '../../../logger.js'
import type { UserRef } from '../../types.js'
import { YouTrackClassifiedError, classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { YouTrackApiError, youtrackFetch } from '../client.js'
import { paginate } from '../helpers.js'

const log = logger.child({ scope: 'provider:youtrack:users' })

const USER_FIELDS = 'id,login,fullName,name,email,ringId'
const PAGE_SIZE = 100
const UNBOUNDED_MAX_PAGES = Number.POSITIVE_INFINITY

const DirectoryUserSchema = z.object({
  id: z.string(),
  login: z.string(),
  fullName: z.string().optional(),
  name: z.string().optional(),
  email: z.string().nullable().optional(),
  ringId: z.string().nullable().optional(),
  $type: z.string().optional(),
})

type DirectoryUser = z.infer<typeof DirectoryUserSchema>

const getUserName = (user: DirectoryUser): string | undefined => user.fullName ?? user.name

const mapUserRef = (user: DirectoryUser): UserRef => ({
  id: user.id,
  login: user.login,
  name: getUserName(user),
})

const matchesQuery = (user: DirectoryUser, query: string | undefined): boolean => {
  if (query === undefined) {
    return true
  }

  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) {
    return true
  }

  return [user.login, getUserName(user), user.email]
    .filter((value): value is string => value !== undefined)
    .some((value) => value.toLowerCase().includes(normalizedQuery))
}

const matchesIdentifier = (user: DirectoryUser, identifier: string): boolean => {
  const normalizedIdentifier = identifier.trim().toLowerCase()

  return (
    user.id === identifier ||
    user.ringId === identifier ||
    user.login.toLowerCase() === normalizedIdentifier ||
    getUserName(user)?.toLowerCase() === normalizedIdentifier
  )
}

const getUserRingId = (user: DirectoryUser, userId: string): string => {
  if (user.ringId !== undefined && user.ringId !== null) {
    return user.ringId
  }

  throw new YouTrackClassifiedError(
    `User "${userId}" is missing a Hub ringId`,
    providerError.validationFailed('userId', 'User is missing a Hub ringId'),
  )
}

const fetchAllUsers = (config: YouTrackConfig): Promise<DirectoryUser[]> =>
  paginate(config, '/api/users', { fields: USER_FIELDS }, DirectoryUserSchema.array(), UNBOUNDED_MAX_PAGES, PAGE_SIZE)

export async function listYouTrackUsers(config: YouTrackConfig, query?: string, limit?: number): Promise<UserRef[]> {
  log.debug({ query, limit }, 'listUsers')

  try {
    const users = await fetchAllUsers(config)
    const filteredUsers = users.filter((user) => matchesQuery(user, query)).map(mapUserRef)
    const limitedUsers = limit === undefined ? filteredUsers : filteredUsers.slice(0, limit)
    log.info({ count: limitedUsers.length }, 'Users listed')
    return limitedUsers
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query, limit }, 'Failed to list users')
    throw classifyYouTrackError(error)
  }
}

export async function resolveYouTrackUserRingId(config: YouTrackConfig, userId: string): Promise<string> {
  log.debug({ userId }, 'resolveUserRingId')

  try {
    const raw = await youtrackFetch(config, 'GET', `/api/users/${userId}`, {
      query: { fields: USER_FIELDS },
    })

    const user = DirectoryUserSchema.parse(raw)
    const ringId = getUserRingId(user, userId)
    log.info({ userId, ringId }, 'Resolved user Hub ringId')
    return ringId
  } catch (error) {
    if (error instanceof YouTrackApiError && error.statusCode === 404) {
      try {
        const users = await fetchAllUsers(config)
        const matchedUser = users.find((user) => matchesIdentifier(user, userId))
        if (matchedUser !== undefined) {
          const ringId = getUserRingId(matchedUser, userId)
          log.info({ userId, ringId }, 'Resolved user Hub ringId from collection scan')
          return ringId
        }
      } catch (fallbackError) {
        log.error(
          { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError), userId },
          'Failed to resolve user Hub ringId from collection scan',
        )
        throw classifyYouTrackError(fallbackError)
      }
    }

    log.error(
      { error: error instanceof Error ? error.message : String(error), userId },
      'Failed to resolve user Hub ringId',
    )
    throw classifyYouTrackError(error)
  }
}

export async function getYouTrackCurrentUser(config: YouTrackConfig): Promise<UserRef> {
  log.debug('getCurrentUser')

  try {
    const raw = await youtrackFetch(config, 'GET', '/api/users/me', {
      query: { fields: USER_FIELDS },
    })

    const user = DirectoryUserSchema.parse(raw)
    log.info({ userId: user.id, login: user.login }, 'Current user retrieved')
    return mapUserRef(user)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get current user')
    throw classifyYouTrackError(error)
  }
}
