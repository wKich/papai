import { logger } from '../../logger.js'
import type { YouTrackConfig } from './client.js'
import { listYouTrackUsers, resolveYouTrackUserRingId } from './operations/users.js'

const log = logger.child({ scope: 'provider:youtrack:identity' })

export interface UserIdentityResolver {
  searchUsers(query: string, limit?: number): Promise<Array<{ id: string; login: string; name?: string }>>
  getUserByLogin(login: string): Promise<{ id: string; login: string; name?: string } | null>
}

export function createYouTrackIdentityResolver(config: YouTrackConfig): UserIdentityResolver {
  log.debug('createYouTrackIdentityResolver called')

  return {
    async searchUsers(query: string, limit?: number) {
      log.debug({ query, limit }, 'YouTrack searchUsers called')

      try {
        const users = await listYouTrackUsers(config, query, limit ?? 10)
        return users.map((u) => ({
          id: u.id,
          login: u.login ?? u.id,
          name: u.name ?? u.login ?? u.id,
        }))
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), query },
          'YouTrack searchUsers failed',
        )
        throw error
      }
    },

    async getUserByLogin(login: string) {
      log.debug({ login }, 'YouTrack getUserByLogin called')

      try {
        const ringId = await resolveYouTrackUserRingId(config, login)
        return {
          id: ringId,
          login,
          name: login,
        }
      } catch (error) {
        log.warn({ login, error: error instanceof Error ? error.message : String(error) }, 'User not found')
        return null
      }
    },
  }
}
