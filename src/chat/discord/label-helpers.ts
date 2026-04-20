import { logger } from '../../logger.js'
import type { ResolveUserContext } from '../types.js'
import type { DiscordClientLike } from './client-factory.js'
import { isGuildLike } from './type-guards.js'

const log = logger.child({ scope: 'chat:discord:labels' })

export function formatDiscordUserLabel(displayName: string | null, username: string | null): string | null {
  if (displayName !== null && username !== null && displayName !== username) {
    return `${displayName} (@${username})`
  }
  if (displayName !== null) return displayName
  if (username !== null) return `@${username}`
  return null
}

export function getDiscordUserDisplayName(
  user: Partial<{
    displayName: string
    globalName: string | null
    username: string
  }>,
): string | null {
  if (user.displayName !== undefined && user.displayName !== '') return user.displayName
  if (user.globalName !== undefined && user.globalName !== null && user.globalName !== '') return user.globalName
  return null
}

export async function resolveDiscordGroupLabel(client: DiscordClientLike, groupId: string): Promise<string | null> {
  if (client.channels === undefined) return null
  const cached = client.channels.cache.get(groupId)
  if (typeof cached === 'object' && cached !== null && 'name' in cached && typeof cached.name === 'string') {
    return cached.name
  }
  if (client.channels.fetch === undefined) return null
  try {
    const ch = await client.channels.fetch(groupId)
    if (typeof ch !== 'object' || ch === null) return null
    if ('name' in ch && typeof ch.name === 'string') return ch.name.length > 0 ? ch.name : null
    return null
  } catch (e) {
    log.warn({ groupId, error: e instanceof Error ? e.message : String(e) }, 'Discord group label lookup failed')
    return null
  }
}

async function tryGuildMemberLabel(
  client: DiscordClientLike,
  userId: string,
  contextId: string,
): Promise<string | null> {
  if (client.channels === undefined || client.guilds === undefined) return null
  const rawChannel = client.channels.cache.get(contextId)
  if (
    typeof rawChannel !== 'object' ||
    rawChannel === null ||
    !('guildId' in rawChannel) ||
    typeof rawChannel.guildId !== 'string'
  ) {
    return null
  }
  const rawGuild = client.guilds.cache.get(rawChannel.guildId)
  if (!isGuildLike(rawGuild) || rawGuild.members.fetch === undefined) return null
  try {
    const member = await rawGuild.members.fetch(userId)
    const displayName = member.displayName !== undefined && member.displayName !== '' ? member.displayName : null
    const userNode = member.user
    const username =
      userNode !== undefined && userNode.username !== undefined && userNode.username !== '' ? userNode.username : null
    return formatDiscordUserLabel(displayName, username)
  } catch (e) {
    log.warn(
      { userId, contextId, error: e instanceof Error ? e.message : String(e) },
      'Discord guild member label lookup failed',
    )
    return null
  }
}

export async function resolveDiscordUserLabel(
  client: DiscordClientLike,
  userId: string,
  context: ResolveUserContext | undefined,
): Promise<string | null> {
  if (context !== undefined && context.contextType === 'group') {
    const guildLabel = await tryGuildMemberLabel(client, userId, context.contextId)
    if (guildLabel !== null) return guildLabel
  }
  if (client.users === undefined) return null
  try {
    const user = await client.users.fetch(userId)
    const displayName = getDiscordUserDisplayName(user)
    const username = user.username !== undefined && user.username !== '' ? user.username : null
    return formatDiscordUserLabel(displayName, username)
  } catch (e) {
    log.warn({ userId, error: e instanceof Error ? e.message : String(e) }, 'Discord user label lookup failed')
    return null
  }
}
