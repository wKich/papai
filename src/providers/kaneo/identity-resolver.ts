import { logger } from '../../logger.js'
import type { KaneoConfig } from './client.js'
import { kaneoListUsers } from './operations/users.js'

const log = logger.child({ scope: 'provider:kaneo:identity' })

export interface UserIdentityResolver {
  searchUsers(query: string, limit?: number): Promise<Array<{ id: string; login: string; name?: string }>>
}

export function createKaneoIdentityResolver(
  config: KaneoConfig,
  workspaceId: string,
): UserIdentityResolver {
  log.debug('createKaneoIdentityResolver called')

  return {
    async searchUsers(query: string, limit?: number) {
      log.debug({ query, limit }, 'Kaneo searchUsers called')

      try {
        const users = await kaneoListUsers(config, workspaceId, query, limit ?? 10)
        return users.map((u) => ({
          id: u.id,
          login: u.login ?? u.id,
          name: u.name ?? u.login ?? u.id,
        }))
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), query },
          'Kaneo searchUsers failed',
        )
        throw error
      }
    },
  }
}
